export const MINIMIZE_COMMENT_QUERY = /* GraphQL */ `
  mutation minimizeComment($id: ID!) {
    minimizeComment(input: { classifier: OUTDATED, subjectId: $id }) {
      clientMutationId
    }
  }
`

export const REMOVE_COMMENT_QUERY = /* GraphQL */ `
  mutation ($id: ID!) {
    deleteIssueComment(input: { id: $id }) {
      clientMutationId
    }
  }
`

export const GET_COMMENTS_QUERY = /* GraphQL */ `
  query comments($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        comments(last: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
          nodes {
            id
            body
            isMinimized
          }
        }
      }
    }
  }
`

export const MAX_GITHUB_COMMENT_BODY_SIZE = 65536
