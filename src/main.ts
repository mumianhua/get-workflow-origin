import * as core from '@actions/core'
// eslint-disable-next-line import/named
import {Octokit as Core, RestEndpointMethodTypes} from '@octokit/action'

const ghApi = process.env['GITHUB_API_URL'] || 'https://api.github.com'

type PullsListResponseData =
  RestEndpointMethodTypes['pulls']['list']['response']['data']

type MyOctokit = InstanceType<typeof Core>

type PullsListRes = PullsListResponseData[0]

async function getWorkflowId(
  octokit: MyOctokit,
  runId: number,
  owner: string,
  repo: string
): Promise<number> {
  const reply = await octokit.rest.actions.getWorkflowRun({
    owner,
    repo,
    run_id: runId
  })
  // eslint-disable-next-line i18n-text/no-en
  core.info(`The source run ${runId} is in ${reply.data.workflow_url} workflow`)
  const workflowIdString = reply.data.workflow_url.split('/').pop() || ''
  if (!(workflowIdString.length > 0)) {
    throw new Error('Could not resolve workflow')
  }
  return parseInt(workflowIdString)
}

function getRequiredEnv(key: string): string {
  const value = process.env[key]
  if (value === undefined) {
    const message = `${key} was not defined.`
    throw new Error(message)
  }
  return value
}

async function findPullRequest(
  octokit: MyOctokit,
  owner: string,
  repo: string,
  headRepo: string,
  headBranch: string | null,
  headSha: string
): Promise<PullsListRes | null> {
  // Finds Pull request for this workflow run
  core.info(`\nFinding PR request id for: owner: ${owner}, Repo:${repo}.\n`)

  const pullRequests = await octokit.paginate(
    'GET /repos/{owner}/{repo}/pulls',
    {
      owner,
      repo
    }
  )

  for (const pullRequest of pullRequests) {
    core.info(
      `\nComparing: ${pullRequest.number} sha: ${pullRequest.head.sha} with expected: ${headSha}.\n`
    )
    if (pullRequest.head.sha === headSha) {
      core.info(
        `\nFound PR: ${pullRequest.number}. ` +
          `Url: ${ghApi}/${owner}/${repo}/pulls/${pullRequest.number}\n`
      )
      return pullRequest
    }
  }
  core.info(`\nCould not find the PR for this build :(\n`)
  return null
}

async function getOrigin(
  octokit: MyOctokit,
  runId: number,
  owner: string,
  repo: string
): Promise<
  [
    string,
    string | null,
    string,
    string,
    string,
    string | null,
    PullsListRes | null
  ]
> {
  const reply = await octokit.rest.actions.getWorkflowRun({
    owner,
    repo,
    run_id: runId
  })
  const sourceRun = reply.data
  core.info(JSON.stringify(reply.data))
  core.info(
    `Source workflow: Head repo: ${sourceRun.head_repository.full_name}, ` +
      `Head branch: ${sourceRun.head_branch} ` +
      `Event: ${sourceRun.event}, Head sha: ${sourceRun.head_sha}, url: ${sourceRun.url}`
  )
  let pullRequest: PullsListRes | null = null

  if (
    sourceRun.event === 'pull_request' ||
    sourceRun.event === 'pull_request_review'
  ) {
    pullRequest = await findPullRequest(
      octokit,
      owner,
      repo,
      sourceRun.head_repository.owner.login,
      sourceRun.head_branch,
      sourceRun.head_sha
    )
  }

  return [
    reply.data.head_repository.full_name,
    reply.data.head_branch,
    reply.data.event,
    reply.data.head_sha,
    pullRequest?.merge_commit_sha ? pullRequest.merge_commit_sha : '',
    pullRequest ? pullRequest.base.ref : reply.data.head_branch,
    pullRequest
  ]
}

function verboseOutput(name: string, value: string): void {
  // eslint-disable-next-line i18n-text/no-en
  core.info(`Setting output: ${name}: ${value}`)
  core.setOutput(name, value)
}

async function run(): Promise<void> {
  const token = core.getInput('token', {required: true})
  const octokit = new Core({
    auth: token
  })
  const selfRunId = parseInt(getRequiredEnv('GITHUB_RUN_ID'))
  const repository = getRequiredEnv('GITHUB_REPOSITORY')
  const eventName = getRequiredEnv('GITHUB_EVENT_NAME')
  const sourceRunId = parseInt(core.getInput('sourceRunId')) || selfRunId
  const [owner, repo] = repository.split('/')

  // core.debug(`\nPayload: ${JSON.stringify(github.context.payload)}\n`)

  core.info(
    `\nGetting workflow id for source run id: ${sourceRunId}, owner: ${owner}, repo: ${repo}\n`
  )
  const sourceWorkflowId = await getWorkflowId(
    octokit,
    sourceRunId,
    owner,
    repo
  )
  core.info(
    `Repository: ${repository}, Owner: ${owner}, Repo: ${repo}, ` +
      `Event name: ${eventName},` +
      `sourceWorkflowId: ${sourceWorkflowId}, sourceRunId: ${sourceRunId}, selfRunId: ${selfRunId}, `
  )

  const [
    headRepo,
    headBranch,
    sourceEventName,
    headSha,
    mergeCommitSha,
    targetBranch,
    pullRequest
  ] = await getOrigin(octokit, sourceRunId, owner, repo)
  core.info('------pull request-11111-----')
  core.info(JSON.stringify(pullRequest))
  core.info('------pull request-22222----')
  verboseOutput('sourceHeadRepo', headRepo)
  headBranch && verboseOutput('sourceHeadBranch', headBranch)
  verboseOutput('sourceHeadSha', headSha)
  verboseOutput('sourceEvent', sourceEventName)
  verboseOutput(
    'pullRequestNumber',
    pullRequest ? pullRequest.number.toString() : ''
  )

  const labelNames = pullRequest ? pullRequest.labels.map(x => x.name) : []
  verboseOutput('pullRequestLabels', JSON.stringify(labelNames))
  verboseOutput('mergeCommitSha', mergeCommitSha)
  verboseOutput('targetCommitSha', pullRequest ? mergeCommitSha : headSha)
  targetBranch && verboseOutput('targetBranch', targetBranch)
}

run()
  // eslint-disable-next-line github/no-then
  .then(() =>
    core.info(
      '\n############### Get Workflow Origin complete ##################\n'
    )
  )
  // eslint-disable-next-line github/no-then
  .catch(e => core.setFailed(e.message))
