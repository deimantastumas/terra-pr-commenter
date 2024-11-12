import * as core from '@actions/core'
import * as fs from 'fs'
import { findTFPlans } from './utils'
import * as diff from 'diff'
import * as yaml from 'yaml'
import * as github from '@actions/github'

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
    const quiet: boolean = core.getBooleanInput('quiet')
    const hidePreviousComments: boolean = core.getBooleanInput(
      'hide-previous-comments'
    )
    const removePreviousComments: boolean = core.getBooleanInput(
      'remove-previous-comments'
    )
    const createMultipleComments: boolean = core.getBooleanInput(
      'create-multiple-comments'
    )
    const octokit = github.getOctokit(githubtoken)
    const context = github.context

    // todo(): input validation

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
          const sensitiveParams = resourceChangeDetails['after_sensitive']
            ? resourceChangeDetails['after_sensitive']
            : {}

          // To prevent exposing sensitive data:
          // 1. Remove sensitive field if there was no change for it
          // 2. Mask sensitive field if there was a change
          for (const sensitiveParamKey in sensitiveParams) {
            if (
              beforeChanges[sensitiveParamKey] ===
              afterChanges[sensitiveParamKey]
            ) {
              delete beforeChanges[sensitiveParamKey]
              delete afterChanges[sensitiveParamKey]
            } else {
              if (sensitiveParamKey in beforeChanges) {
                beforeChanges[sensitiveParamKey] = 'OLD_SENSITIVE_VALUE'
              }
              if (sensitiveParamKey in afterChanges) {
                afterChanges[sensitiveParamKey] = 'NEW_SENSITIVE_VALUE'
              }
            }
          }

          // Create a diff from before and after changes
          const beforeYaml = yaml.stringify(beforeChanges)
          const afterYaml = yaml.stringify(afterChanges)
          const changeDiff = diff.createPatch(
            resourceAddress,
            beforeYaml,
            afterYaml
          )

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

          planChanges.ResouceChangeBody.push({
            Address: resourceAddress,
            ChangeDif: changeDiff,
            Action: overallAction
          })

          // Create change content for comment body
          let changeContent = ''
          for (const resourceChangeBody of planChanges.ResouceChangeBody) {
            changeContent += `
\`\`\`diff
${resourceChangeBody.ChangeDif}
\`\`\`

`
          }

          // Create comment
          const commentBody = `
<b>${resolvedCommentHeader}<b>
![add](https://img.shields.io/badge/add-${planChanges.CreateResourcesCount}-brightgreen) ![change](https://img.shields.io/badge/change-${planChanges.UpdateResourcesCount}-yellow) ![replace](https://img.shields.io/badge/change-${planChanges.ReplaceResourcesCount}-orange) ![destroy](https://img.shields.io/badge/destroy-${planChanges.DestroyResourcesCount}-red)
<details${expandComment ? ' open' : ''}>
<summary>
<b>Terraform Diff:</b>
</summary>

${changeContent}
</details>
`
          octokit.rest.issues.createComment({
            issue_number: context.issue.number,
            owner: context.repo.owner,
            repo: context.repo.repo,
            body: commentBody
          })
        }
      } catch (error) {
        if (error instanceof Error)
          core.setFailed(`TF plan ${tfPlan} is invalid: ${error}`)
        return
      }
    }

    // Set outputs for other workflow steps to use
    core.setOutput('time', new Date().toTimeString())
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
