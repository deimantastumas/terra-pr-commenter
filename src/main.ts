import * as core from '@actions/core'
import { findTFPlans } from './utils'

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

    // todo(): input validation

    // Find TF plan JSON files
    const tfPlanFiles = findTFPlans(tfPlanLookupDir, tfPlanLookupName)
    console.log(JSON.stringify(tfPlanFiles))

    // Set outputs for other workflow steps to use
    core.setOutput('time', new Date().toTimeString())
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
