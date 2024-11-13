import * as core from '@actions/core'
import * as fs from 'fs'
import { findTFPlans } from './utils'
import * as diff from 'diff'
import * as yaml from 'yaml'
import * as github from '@actions/github'
import { COMMENT_FOOTER, MAX_GITHUB_COMMENT_BODY_SIZE } from './constants'
import { CreatePRComment, RemoveCommentsByLookupText } from './pull-request'

interface PlanChanges {
  CreateResourcesCount: number
  UpdateResourcesCount: number
  DestroyResourcesCount: number
  ReplaceResourcesCount: number
  ResouceChangeBody: ResourceChangeBody[]
}

interface ResourceChangeBody {
  Address: string
  ChangeDif: string
  Action: string
}

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    // Define action inputs
    const tfPlanLookupDir: string = core.getInput('tf-plan-lookup-dir')
    const tfPlanLookupName: string = core.getInput('tf-plan-lookup-name')
    const githubtoken: string = core.getInput('github-token')
    const expandComment: boolean = core.getBooleanInput('expand-comment')
    const headingPlanVariableName: string = core.getInput(
      'heading-plan-variable-name'
    )
    const commentHeader: string = core.getInput('comment-header')
    const removePreviousComments: boolean = core.getBooleanInput(
      'remove-previous-comments'
    )
    const octokit = github.getOctokit(githubtoken)
    const context = github.context

    // todo(): add input validation

    // Find TF plan JSON files
    const tfPlanFiles = findTFPlans(tfPlanLookupDir, tfPlanLookupName)

    // Go through TF plans and create comment bodies
    for (const tfPlan of tfPlanFiles) {
      core.info(`Parsing TF plan: ${tfPlan}`)
      const planContent = fs.readFileSync(tfPlan)
      const parsedContent = JSON.parse(planContent.toString())
      let resolvedCommentHeader = commentHeader

      const planChanges: PlanChanges = {
        CreateResourcesCount: 0,
        UpdateResourcesCount: 0,
        DestroyResourcesCount: 0,
        ReplaceResourcesCount: 0,
        ResouceChangeBody: []
      }

      // If 'heading-plan-variable-name' is passed - use this variable for resolving heading value
      if (headingPlanVariableName !== '') {
        // Check if passed variable actually exists in the plan
        if (
          'variables' in parsedContent &&
          headingPlanVariableName in parsedContent['variables']
        ) {
          resolvedCommentHeader =
            parsedContent['variables'][headingPlanVariableName]['value']
        } else {
          core.warning(
            `Passed variable ${headingPlanVariableName} doesn't exist in the plan. Defaulting to ${resolvedCommentHeader}`
          )
        }
      }

      let resourceChanges = []
      try {
        resourceChanges = parsedContent['resource_changes']
        // Parse resource changes
        for (const resourceChange of resourceChanges) {
          const resourceAddress: string = resourceChange['address']
          const resourceChangeDetails = resourceChange['change']

          // Skip change if it's 'no-op'
          const resourceChangeActions: string[] =
            resourceChangeDetails['actions']
          if (resourceChangeActions.includes('no-op')) {
            continue
          }

          const beforeChanges = resourceChangeDetails['before']
            ? resourceChangeDetails['before']
            : {}
          const afterChanges = resourceChangeDetails['after']
            ? resourceChangeDetails['after']
            : {}
          const beforeSensitiveParams = resourceChangeDetails[
            'before_sensitive'
          ]
            ? resourceChangeDetails['before_sensitive']
            : {}
          const afterSensitiveParams = resourceChangeDetails['after_sensitive']
            ? resourceChangeDetails['after_sensitive']
            : {}

          // To prevent exposing sensitive data:
          // 1. Remove sensitive field if there was no change for it
          // 2. Mask sensitive field if there was a change
          for (const sensitiveParamKey in beforeSensitiveParams) {
            if (
              beforeChanges[sensitiveParamKey] ===
              afterChanges[sensitiveParamKey]
            ) {
              delete beforeChanges[sensitiveParamKey]
              delete afterChanges[sensitiveParamKey]
            } else {
              if (sensitiveParamKey in beforeChanges) {
                beforeChanges[sensitiveParamKey] = '(OLD_SENSITIVE_VALUE)'
              }
              if (sensitiveParamKey in afterChanges) {
                afterChanges[sensitiveParamKey] = '(NEW_SENSITIVE_VALUE)'
              }
            }
          }

          for (const sensitiveParamKey in afterSensitiveParams) {
            if (
              beforeChanges[sensitiveParamKey] ===
              afterChanges[sensitiveParamKey]
            ) {
              delete beforeChanges[sensitiveParamKey]
              delete afterChanges[sensitiveParamKey]
            } else {
              if (sensitiveParamKey in beforeChanges) {
                beforeChanges[sensitiveParamKey] = '(OLD_SENSITIVE_VALUE)'
              }
              if (sensitiveParamKey in afterChanges) {
                afterChanges[sensitiveParamKey] = '(NEW_SENSITIVE_VALUE)'
              }
            }
          }

          // Resolve resource change action
          let overallAction = ''
          switch (resourceChangeActions[0]) {
            case 'create':
              overallAction = 'Create'
              planChanges.CreateResourcesCount += 1
              break
            case 'delete':
              if (
                resourceChangeActions.includes('delete') &&
                resourceChangeActions.includes('create')
              ) {
                planChanges.CreateResourcesCount += 1
                planChanges.DestroyResourcesCount += 1
                planChanges.ReplaceResourcesCount += 1
                overallAction = 'Replace'
              } else {
                planChanges.DestroyResourcesCount += 1
                overallAction = 'Destroy'
              }
              break
            case 'update':
              planChanges.UpdateResourcesCount += 1
              overallAction = 'Update'
          }

          // Create a diff from before and after changes
          const beforeYaml = yaml.stringify(beforeChanges)
          const afterYaml = yaml.stringify(afterChanges)

          let changeDiff = ''
          if (overallAction === 'Create' || overallAction === 'Update') {
            changeDiff = diff.createPatch(
              resourceAddress,
              beforeYaml,
              afterYaml,
              undefined,
              overallAction
            )
          } else {
            changeDiff = diff.createPatch(
              resourceAddress,
              beforeYaml,
              afterYaml,
              overallAction,
              undefined
            )
          }

          // Sanitize diff to be more readable
          // 1. Remove lines without changes (that don't start with '+' or '-')
          changeDiff = changeDiff.replace(/^(?![+-]).*\n?/gm, '')

          // 2. Remove lines that only has '-{}' or '+{}'
          changeDiff = changeDiff.replace(/^-{}\n?/gm, '')
          changeDiff = changeDiff.replace(/^\+{}\n?/gm, '')

          // 3. Add diff heading
          changeDiff = `
Resource: ${resourceAddress}
===================================================================
${changeDiff}
`

          planChanges.ResouceChangeBody.push({
            Address: resourceAddress,
            ChangeDif: changeDiff,
            Action: overallAction
          })
        }
      } catch (error) {
        if (error instanceof Error)
          core.setFailed(`TF plan ${tfPlan} is invalid: ${error}`)
        return
      }

      // Create change content for comment body
      let resourcesToCreateContent = `
#### Resources to create:

`
      let resourcesToDestroyContent = `
#### Resources to destroy:

`
      let resourcesToUpdateContent = `
#### Resources to update:

`
      let resourcesToReplaceContent = `
#### Resources to replace:

`
      for (const resourceChangeBody of planChanges.ResouceChangeBody) {
        switch (resourceChangeBody.Action) {
          case 'Create':
            resourcesToCreateContent += `
\`\`\`diff${resourceChangeBody.ChangeDif}\`\`\`

`
            break
          case 'Update':
            resourcesToUpdateContent += `
\`\`\`diff${resourceChangeBody.ChangeDif}\`\`\`

`
            break
          case 'Destroy':
            resourcesToDestroyContent += `
\`\`\`diff${resourceChangeBody.ChangeDif}\`\`\`

`
            break
          case 'Replace':
            resourcesToReplaceContent += `
\`\`\`diff${resourceChangeBody.ChangeDif}\`\`\`

`
        }
      }

      // Create comment
      const commentBody = `
<b>${resolvedCommentHeader}<b>

![Create](https://img.shields.io/badge/Create-${planChanges.CreateResourcesCount}-brightgreen) ![Update](https://img.shields.io/badge/Update-${planChanges.UpdateResourcesCount}-yellow) ![Replace](https://img.shields.io/badge/Replace-${planChanges.ReplaceResourcesCount}-orange) ![Destroy](https://img.shields.io/badge/Destroy-${planChanges.DestroyResourcesCount}-red)
<details${expandComment ? ' open' : ''}>
<summary>
<b>Resource changes:</b>
</summary>

${planChanges.CreateResourcesCount > planChanges.ReplaceResourcesCount ? resourcesToCreateContent : ''}
${planChanges.DestroyResourcesCount > planChanges.ReplaceResourcesCount ? resourcesToDestroyContent : ''}
${planChanges.UpdateResourcesCount > 0 ? resourcesToUpdateContent : ''}
${planChanges.ReplaceResourcesCount > 0 ? resourcesToReplaceContent : ''}
</details>

${COMMENT_FOOTER}
`
      // todo(): handle cases when comments are too large instead of failing the action.
      // In theory - it shouldn't happen as the output is already compressed quite a lot
      // and reaching the '65536' characters limit shouldn't really happen
      if (commentBody.length > MAX_GITHUB_COMMENT_BODY_SIZE) {
        core.setFailed(
          `Comment body size is too large for GitHub comment: ${commentBody.length} > ${MAX_GITHUB_COMMENT_BODY_SIZE}`
        )
        return
      }

      // Remove previous comments that were created by this action
      await RemoveCommentsByLookupText(octokit, context, COMMENT_FOOTER)

      // Create a comment
      await CreatePRComment(octokit, context, commentBody)
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}
