import { Context } from '@actions/github/lib/context'
import { GitHub } from '@actions/github/lib/utils'
import { GET_COMMENTS_QUERY, REMOVE_COMMENT_QUERY } from './constants'
import * as core from '@actions/core'

type IssueCommentsResponse = {
  repository: {
    pullRequest: {
      comments: {
        nodes: Array<IssueComment>
      }
    }
  }
}

type IssueComment = {
  id: string
  body: string
  isMinimized: boolean
}

export const CreatePRComment = async (
  octokit: InstanceType<typeof GitHub>,
  context: Context,
  commentBody: string
) => {
  await octokit.rest.issues.createComment({
    issue_number: context.issue.number,
    owner: context.repo.owner,
    repo: context.repo.repo,
    body: commentBody
  })
}

export const RemoveCommentsByLookupText = async (
  octokit: InstanceType<typeof GitHub>,
  context: Context,
  lookupText: string
) => {
  const targetComments = await QueryCommentsByLookupText(
    octokit,
    context,
    lookupText
  )

  targetComments.forEach(async comment => {
    try {
      await octokit.graphql(REMOVE_COMMENT_QUERY, {
        id: comment.id
      })
    } catch (error) {
      core.warning(
        `Failed to remove the comment ${comment.id} for PR #${context.issue.number}`
      )
    }
  })
}

export const QueryCommentsByLookupText = async (
  octokit: InstanceType<typeof GitHub>,
  context: Context,
  lookupText: string
): Promise<IssueComment[]> => {
  const issueCommentsResponse = await octokit.graphql<IssueCommentsResponse>(
    GET_COMMENTS_QUERY,
    {
      owner: context.repo.owner,
      name: context.repo.repo,
      number: context.issue.number
    }
  )
  core.info(`Successfully retrieved comments for PR #${context.issue.number}.`)

  const issueComments =
    issueCommentsResponse.repository.pullRequest.comments.nodes
  const filteredComments = issueComments.filter(comment =>
    comment.body.includes(lookupText)
  )

  if (filteredComments.length === 0) {
    core.info(`No comments created by action were found. Skipping the cleanup`)
    return []
  } else {
    core.info(
      `${filteredComments.length} will be removed from PR #${context.issue}`
    )
  }
  return filteredComments
}
