const SignatureHelper = require('../../utils/signatureHelper');

// Set required environment variables before requiring modules
process.env.BOT_USERNAME = '@TestBot';
process.env.NODE_ENV = 'test';
process.env.GITHUB_TOKEN = 'test_token';
process.env.AUTHORIZED_USERS = 'testuser,admin';

// Mock secureCredentials before requiring actual modules
jest.mock('../../../src/utils/secureCredentials', () => ({
  get: jest.fn(key => {
    const mockCredentials = {
      GITHUB_WEBHOOK_SECRET: 'test_secret',
      GITHUB_TOKEN: 'test_token',
      ANTHROPIC_API_KEY: 'test_anthropic_key'
    };
    return mockCredentials[key] || null;
  }),
  has: jest.fn(key => {
    const mockCredentials = {
      GITHUB_WEBHOOK_SECRET: 'test_secret',
      GITHUB_TOKEN: 'test_token',
      ANTHROPIC_API_KEY: 'test_anthropic_key'
    };
    return !!mockCredentials[key];
  })
}));

// Mock services before requiring actual modules
jest.mock('../../../src/services/claudeService', () => ({
  processCommand: jest.fn().mockResolvedValue('Claude response')
}));

jest.mock('../../../src/services/githubService', () => ({
  postComment: jest.fn().mockResolvedValue({ id: 456 }),
  createIssue: jest
    .fn()
    .mockResolvedValue({ number: 999, html_url: 'https://github.com/owner/repo/issues/999' }),
  addLabelsToIssue: jest.fn().mockResolvedValue([]),
  getFallbackLabels: jest.fn().mockReturnValue([]),
  hasReviewedPRAtCommit: jest.fn().mockResolvedValue(false),
  getCheckSuitesForRef: jest.fn().mockResolvedValue({ total_count: 0, check_suites: [] }),
  managePRLabels: jest.fn().mockResolvedValue(undefined),
  getPullRequestDetails: jest.fn().mockResolvedValue(null)
}));

// Now require modules after environment and mocks are set up
const githubController =
  require('../../../src/controllers/githubController').default ||
  require('../../../src/controllers/githubController');
const claudeService =
  require('../../../src/services/claudeService').default ||
  require('../../../src/services/claudeService');
const githubService =
  require('../../../src/services/githubService').default ||
  require('../../../src/services/githubService');

describe('GitHub Controller - Issue Assigned', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();

    req = {
      headers: {
        'x-github-event': 'issues',
        'x-hub-signature-256': '',
        'x-github-delivery': 'test-delivery-id'
      },
      body: {
        action: 'assigned',
        assignee: {
          login: 'TestBot',
          id: 1,
          type: 'Bot',
          html_url: 'https://github.com/TestBot'
        },
        issue: {
          number: 42,
          title: 'Add new feature',
          body: 'Please implement this feature with tests.',
          id: 100,
          state: 'open',
          user: {
            login: 'testuser',
            id: 2,
            type: 'User',
            html_url: 'https://github.com/testuser'
          },
          labels: [],
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          html_url: 'https://github.com/owner/repo/issues/42'
        },
        repository: {
          full_name: 'owner/repo',
          name: 'repo',
          owner: {
            login: 'owner'
          }
        },
        sender: {
          login: 'testuser'
        }
      }
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    process.env.GITHUB_WEBHOOK_SECRET = 'test_secret';

    req.headers['x-hub-signature-256'] = SignatureHelper.createGitHubSignature(
      req.body,
      process.env.GITHUB_WEBHOOK_SECRET
    );

    claudeService.processCommand.mockResolvedValue('Claude response');
    githubService.postComment.mockResolvedValue({ id: 456 });
    githubService.createIssue.mockResolvedValue({
      number: 999,
      html_url: 'https://github.com/owner/repo/issues/999'
    });
  });

  test('should process command when bot is assignee and sender is authorized', async () => {
    await githubController.handleWebhook(req, res);

    expect(claudeService.processCommand).toHaveBeenCalledWith({
      repoFullName: 'owner/repo',
      issueNumber: 42,
      command: 'Add new feature\n\nPlease implement this feature with tests.',
      isPullRequest: false,
      branchName: null,
      operationType: 'default'
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'Issue assignment processed successfully'
      })
    );

    // Should not post a comment on the issue (expected outcome is a PR)
    expect(githubService.postComment).not.toHaveBeenCalled();
  });

  test('should reject when sender is unauthorized', async () => {
    req.body.sender.login = 'unauthorizeduser';

    req.headers['x-hub-signature-256'] = SignatureHelper.createGitHubSignature(
      req.body,
      process.env.GITHUB_WEBHOOK_SECRET
    );

    await githubController.handleWebhook(req, res);

    expect(claudeService.processCommand).not.toHaveBeenCalled();

    expect(githubService.postComment).toHaveBeenCalledWith(
      expect.objectContaining({
        repoOwner: 'owner',
        repoName: 'repo',
        issueNumber: 42,
        body: expect.stringContaining('only authorized users')
      })
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'Unauthorized user - assignment ignored'
      })
    );
  });

  test('should ignore when assignee is not the bot', async () => {
    req.body.assignee.login = 'someoneelse';

    req.headers['x-hub-signature-256'] = SignatureHelper.createGitHubSignature(
      req.body,
      process.env.GITHUB_WEBHOOK_SECRET
    );

    await githubController.handleWebhook(req, res);

    expect(claudeService.processCommand).not.toHaveBeenCalled();
    expect(githubService.postComment).not.toHaveBeenCalled();

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: 'Webhook processed successfully' });
  });

  test('should create error issue when processCommand fails', async () => {
    claudeService.processCommand.mockRejectedValue(new Error('Claude processing failed'));

    await githubController.handleWebhook(req, res);

    expect(githubService.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        repoOwner: 'owner',
        repoName: 'repo',
        title: 'Bot failed to process issue #42',
        body: expect.stringContaining('Claude processing failed')
      })
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'Failed to process assigned issue'
      })
    );
  });

  test('should handle null issue body gracefully', async () => {
    req.body.issue.body = null;

    req.headers['x-hub-signature-256'] = SignatureHelper.createGitHubSignature(
      req.body,
      process.env.GITHUB_WEBHOOK_SECRET
    );

    await githubController.handleWebhook(req, res);

    expect(claudeService.processCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'Add new feature\n\n'
      })
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });
});
