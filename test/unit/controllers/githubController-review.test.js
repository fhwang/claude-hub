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
  postComment: jest.fn().mockResolvedValue({ id: 456 })
}));

// Now require modules after environment and mocks are set up
const githubController =
  require('../../../src/controllers/githubController').default ||
  require('../../../src/controllers/githubController');
const claudeService =
  require('../../../src/services/claudeService').default ||
  require('../../../src/services/claudeService');

describe('GitHub Controller - PR Review Auto-Response', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    process.env.GITHUB_WEBHOOK_SECRET = 'test_secret';
    claudeService.processCommand.mockResolvedValue('Claude response');
  });

  describe('pull_request_review.submitted', () => {
    test('should process review on bot-authored PR with changes_requested', async () => {
      req = {
        headers: {
          'x-github-event': 'pull_request_review',
          'x-hub-signature-256': '',
          'x-github-delivery': 'test-delivery-id'
        },
        body: {
          action: 'submitted',
          review: {
            id: 1,
            body: 'Please fix the error handling in the catch block',
            state: 'changes_requested',
            user: { login: 'reviewer', id: 10 },
            html_url: 'https://github.com/owner/repo/pull/1#pullrequestreview-1',
            commit_id: 'abc123',
            submitted_at: '2026-02-23T00:00:00Z'
          },
          pull_request: {
            id: 1,
            number: 42,
            title: 'Add feature',
            body: 'Feature PR',
            state: 'open',
            user: { login: 'TestBot', id: 100 },
            head: { ref: 'feature-branch', sha: 'abc123', repo: null },
            base: {
              ref: 'main',
              sha: 'def456',
              repo: {
                id: 1,
                name: 'repo',
                full_name: 'owner/repo',
                owner: { login: 'owner', id: 2 },
                private: false,
                html_url: 'https://github.com/owner/repo',
                default_branch: 'main'
              }
            },
            labels: [],
            created_at: '2026-02-23T00:00:00Z',
            updated_at: '2026-02-23T00:00:00Z',
            html_url: 'https://github.com/owner/repo/pull/42',
            merged: false,
            mergeable: true,
            draft: false,
            merged_at: null
          },
          repository: {
            id: 1,
            name: 'repo',
            full_name: 'owner/repo',
            owner: { login: 'owner', id: 2 },
            private: false,
            html_url: 'https://github.com/owner/repo',
            default_branch: 'main'
          },
          sender: { login: 'reviewer', id: 10 }
        }
      };

      req.headers['x-hub-signature-256'] = SignatureHelper.createGitHubSignature(
        req.body,
        process.env.GITHUB_WEBHOOK_SECRET
      );

      await githubController.handleWebhook(req, res);

      expect(claudeService.processCommand).toHaveBeenCalledWith({
        repoFullName: 'owner/repo',
        issueNumber: 42,
        command: expect.stringContaining('Please fix the error handling in the catch block'),
        isPullRequest: true,
        branchName: 'feature-branch'
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true
        })
      );
    });

    test('should ignore review on non-bot-authored PR', async () => {
      req = {
        headers: {
          'x-github-event': 'pull_request_review',
          'x-hub-signature-256': '',
          'x-github-delivery': 'test-delivery-id'
        },
        body: {
          action: 'submitted',
          review: {
            id: 1,
            body: 'Looks good',
            state: 'commented',
            user: { login: 'reviewer', id: 10 },
            html_url: 'https://github.com/owner/repo/pull/1#pullrequestreview-1',
            commit_id: 'abc123',
            submitted_at: '2026-02-23T00:00:00Z'
          },
          pull_request: {
            id: 1,
            number: 42,
            title: 'Add feature',
            body: 'Feature PR',
            state: 'open',
            user: { login: 'someuser', id: 99 },
            head: { ref: 'feature-branch', sha: 'abc123', repo: null },
            base: {
              ref: 'main',
              sha: 'def456',
              repo: {
                id: 1,
                name: 'repo',
                full_name: 'owner/repo',
                owner: { login: 'owner', id: 2 },
                private: false,
                html_url: 'https://github.com/owner/repo',
                default_branch: 'main'
              }
            },
            labels: [],
            created_at: '2026-02-23T00:00:00Z',
            updated_at: '2026-02-23T00:00:00Z',
            html_url: 'https://github.com/owner/repo/pull/42',
            merged: false,
            mergeable: true,
            draft: false,
            merged_at: null
          },
          repository: {
            id: 1,
            name: 'repo',
            full_name: 'owner/repo',
            owner: { login: 'owner', id: 2 },
            private: false,
            html_url: 'https://github.com/owner/repo',
            default_branch: 'main'
          },
          sender: { login: 'reviewer', id: 10 }
        }
      };

      req.headers['x-hub-signature-256'] = SignatureHelper.createGitHubSignature(
        req.body,
        process.env.GITHUB_WEBHOOK_SECRET
      );

      await githubController.handleWebhook(req, res);

      expect(claudeService.processCommand).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Webhook processed successfully' });
    });

    test('should ignore approved reviews on bot-authored PR', async () => {
      req = {
        headers: {
          'x-github-event': 'pull_request_review',
          'x-hub-signature-256': '',
          'x-github-delivery': 'test-delivery-id'
        },
        body: {
          action: 'submitted',
          review: {
            id: 1,
            body: 'LGTM',
            state: 'approved',
            user: { login: 'reviewer', id: 10 },
            html_url: 'https://github.com/owner/repo/pull/1#pullrequestreview-1',
            commit_id: 'abc123',
            submitted_at: '2026-02-23T00:00:00Z'
          },
          pull_request: {
            id: 1,
            number: 42,
            title: 'Add feature',
            body: 'Feature PR',
            state: 'open',
            user: { login: 'TestBot', id: 100 },
            head: { ref: 'feature-branch', sha: 'abc123', repo: null },
            base: {
              ref: 'main',
              sha: 'def456',
              repo: {
                id: 1,
                name: 'repo',
                full_name: 'owner/repo',
                owner: { login: 'owner', id: 2 },
                private: false,
                html_url: 'https://github.com/owner/repo',
                default_branch: 'main'
              }
            },
            labels: [],
            created_at: '2026-02-23T00:00:00Z',
            updated_at: '2026-02-23T00:00:00Z',
            html_url: 'https://github.com/owner/repo/pull/42',
            merged: false,
            mergeable: true,
            draft: false,
            merged_at: null
          },
          repository: {
            id: 1,
            name: 'repo',
            full_name: 'owner/repo',
            owner: { login: 'owner', id: 2 },
            private: false,
            html_url: 'https://github.com/owner/repo',
            default_branch: 'main'
          },
          sender: { login: 'reviewer', id: 10 }
        }
      };

      req.headers['x-hub-signature-256'] = SignatureHelper.createGitHubSignature(
        req.body,
        process.env.GITHUB_WEBHOOK_SECRET
      );

      await githubController.handleWebhook(req, res);

      expect(claudeService.processCommand).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should skip review with empty body on bot-authored PR', async () => {
      req = {
        headers: {
          'x-github-event': 'pull_request_review',
          'x-hub-signature-256': '',
          'x-github-delivery': 'test-delivery-id'
        },
        body: {
          action: 'submitted',
          review: {
            id: 1,
            body: null,
            state: 'commented',
            user: { login: 'reviewer', id: 10 },
            html_url: 'https://github.com/owner/repo/pull/1#pullrequestreview-1',
            commit_id: 'abc123',
            submitted_at: '2026-02-23T00:00:00Z'
          },
          pull_request: {
            id: 1,
            number: 42,
            title: 'Add feature',
            body: 'Feature PR',
            state: 'open',
            user: { login: 'TestBot', id: 100 },
            head: { ref: 'feature-branch', sha: 'abc123', repo: null },
            base: {
              ref: 'main',
              sha: 'def456',
              repo: {
                id: 1,
                name: 'repo',
                full_name: 'owner/repo',
                owner: { login: 'owner', id: 2 },
                private: false,
                html_url: 'https://github.com/owner/repo',
                default_branch: 'main'
              }
            },
            labels: [],
            created_at: '2026-02-23T00:00:00Z',
            updated_at: '2026-02-23T00:00:00Z',
            html_url: 'https://github.com/owner/repo/pull/42',
            merged: false,
            mergeable: true,
            draft: false,
            merged_at: null
          },
          repository: {
            id: 1,
            name: 'repo',
            full_name: 'owner/repo',
            owner: { login: 'owner', id: 2 },
            private: false,
            html_url: 'https://github.com/owner/repo',
            default_branch: 'main'
          },
          sender: { login: 'reviewer', id: 10 }
        }
      };

      req.headers['x-hub-signature-256'] = SignatureHelper.createGitHubSignature(
        req.body,
        process.env.GITHUB_WEBHOOK_SECRET
      );

      await githubController.handleWebhook(req, res);

      expect(claudeService.processCommand).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('should prevent self-loop when bot is the reviewer', async () => {
      req = {
        headers: {
          'x-github-event': 'pull_request_review',
          'x-hub-signature-256': '',
          'x-github-delivery': 'test-delivery-id'
        },
        body: {
          action: 'submitted',
          review: {
            id: 1,
            body: 'Some automated review feedback',
            state: 'commented',
            user: { login: 'TestBot', id: 100 },
            html_url: 'https://github.com/owner/repo/pull/1#pullrequestreview-1',
            commit_id: 'abc123',
            submitted_at: '2026-02-23T00:00:00Z'
          },
          pull_request: {
            id: 1,
            number: 42,
            title: 'Add feature',
            body: 'Feature PR',
            state: 'open',
            user: { login: 'TestBot', id: 100 },
            head: { ref: 'feature-branch', sha: 'abc123', repo: null },
            base: {
              ref: 'main',
              sha: 'def456',
              repo: {
                id: 1,
                name: 'repo',
                full_name: 'owner/repo',
                owner: { login: 'owner', id: 2 },
                private: false,
                html_url: 'https://github.com/owner/repo',
                default_branch: 'main'
              }
            },
            labels: [],
            created_at: '2026-02-23T00:00:00Z',
            updated_at: '2026-02-23T00:00:00Z',
            html_url: 'https://github.com/owner/repo/pull/42',
            merged: false,
            mergeable: true,
            draft: false,
            merged_at: null
          },
          repository: {
            id: 1,
            name: 'repo',
            full_name: 'owner/repo',
            owner: { login: 'owner', id: 2 },
            private: false,
            html_url: 'https://github.com/owner/repo',
            default_branch: 'main'
          },
          sender: { login: 'TestBot', id: 100 }
        }
      };

      req.headers['x-hub-signature-256'] = SignatureHelper.createGitHubSignature(
        req.body,
        process.env.GITHUB_WEBHOOK_SECRET
      );

      await githubController.handleWebhook(req, res);

      expect(claudeService.processCommand).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('pull_request_review_comment on bot-authored PR', () => {
    test('should auto-respond to review comment without @mention on bot-authored PR', async () => {
      req = {
        headers: {
          'x-github-event': 'pull_request_review_comment',
          'x-hub-signature-256': '',
          'x-github-delivery': 'test-delivery-id'
        },
        body: {
          action: 'created',
          comment: {
            id: 789,
            body: 'This variable name is confusing, please rename it',
            user: { login: 'reviewer', id: 10 },
            created_at: '2026-02-23T00:00:00Z',
            updated_at: '2026-02-23T00:00:00Z',
            html_url: 'https://github.com/owner/repo/pull/42#discussion_r789'
          },
          pull_request: {
            id: 1,
            number: 42,
            title: 'Add feature',
            body: 'Feature PR',
            state: 'open',
            user: { login: 'TestBot', id: 100 },
            head: { ref: 'feature-branch', sha: 'abc123', repo: null },
            base: {
              ref: 'main',
              sha: 'def456',
              repo: {
                id: 1,
                name: 'repo',
                full_name: 'owner/repo',
                owner: { login: 'owner', id: 2 },
                private: false,
                html_url: 'https://github.com/owner/repo',
                default_branch: 'main'
              }
            },
            labels: [],
            created_at: '2026-02-23T00:00:00Z',
            updated_at: '2026-02-23T00:00:00Z',
            html_url: 'https://github.com/owner/repo/pull/42',
            merged: false,
            mergeable: true,
            draft: false,
            merged_at: null
          },
          repository: {
            id: 1,
            name: 'repo',
            full_name: 'owner/repo',
            owner: { login: 'owner', id: 2 },
            private: false,
            html_url: 'https://github.com/owner/repo',
            default_branch: 'main'
          },
          sender: { login: 'reviewer', id: 10 }
        }
      };

      req.headers['x-hub-signature-256'] = SignatureHelper.createGitHubSignature(
        req.body,
        process.env.GITHUB_WEBHOOK_SECRET
      );

      await githubController.handleWebhook(req, res);

      expect(claudeService.processCommand).toHaveBeenCalledWith({
        repoFullName: 'owner/repo',
        issueNumber: 42,
        command: expect.stringContaining('This variable name is confusing, please rename it'),
        isPullRequest: true,
        branchName: 'feature-branch'
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('should not auto-respond to review comment on non-bot-authored PR without @mention', async () => {
      req = {
        headers: {
          'x-github-event': 'pull_request_review_comment',
          'x-hub-signature-256': '',
          'x-github-delivery': 'test-delivery-id'
        },
        body: {
          action: 'created',
          comment: {
            id: 789,
            body: 'This needs fixing',
            user: { login: 'reviewer', id: 10 },
            created_at: '2026-02-23T00:00:00Z',
            updated_at: '2026-02-23T00:00:00Z',
            html_url: 'https://github.com/owner/repo/pull/42#discussion_r789'
          },
          pull_request: {
            id: 1,
            number: 42,
            title: 'Add feature',
            body: 'Feature PR',
            state: 'open',
            user: { login: 'someuser', id: 99 },
            head: { ref: 'feature-branch', sha: 'abc123', repo: null },
            base: {
              ref: 'main',
              sha: 'def456',
              repo: {
                id: 1,
                name: 'repo',
                full_name: 'owner/repo',
                owner: { login: 'owner', id: 2 },
                private: false,
                html_url: 'https://github.com/owner/repo',
                default_branch: 'main'
              }
            },
            labels: [],
            created_at: '2026-02-23T00:00:00Z',
            updated_at: '2026-02-23T00:00:00Z',
            html_url: 'https://github.com/owner/repo/pull/42',
            merged: false,
            mergeable: true,
            draft: false,
            merged_at: null
          },
          repository: {
            id: 1,
            name: 'repo',
            full_name: 'owner/repo',
            owner: { login: 'owner', id: 2 },
            private: false,
            html_url: 'https://github.com/owner/repo',
            default_branch: 'main'
          },
          sender: { login: 'reviewer', id: 10 }
        }
      };

      req.headers['x-hub-signature-256'] = SignatureHelper.createGitHubSignature(
        req.body,
        process.env.GITHUB_WEBHOOK_SECRET
      );

      await githubController.handleWebhook(req, res);

      expect(claudeService.processCommand).not.toHaveBeenCalled();
    });

    test('should prevent self-loop when bot comments on its own PR review', async () => {
      req = {
        headers: {
          'x-github-event': 'pull_request_review_comment',
          'x-hub-signature-256': '',
          'x-github-delivery': 'test-delivery-id'
        },
        body: {
          action: 'created',
          comment: {
            id: 789,
            body: 'I fixed this in the latest commit',
            user: { login: 'TestBot', id: 100 },
            created_at: '2026-02-23T00:00:00Z',
            updated_at: '2026-02-23T00:00:00Z',
            html_url: 'https://github.com/owner/repo/pull/42#discussion_r789'
          },
          pull_request: {
            id: 1,
            number: 42,
            title: 'Add feature',
            body: 'Feature PR',
            state: 'open',
            user: { login: 'TestBot', id: 100 },
            head: { ref: 'feature-branch', sha: 'abc123', repo: null },
            base: {
              ref: 'main',
              sha: 'def456',
              repo: {
                id: 1,
                name: 'repo',
                full_name: 'owner/repo',
                owner: { login: 'owner', id: 2 },
                private: false,
                html_url: 'https://github.com/owner/repo',
                default_branch: 'main'
              }
            },
            labels: [],
            created_at: '2026-02-23T00:00:00Z',
            updated_at: '2026-02-23T00:00:00Z',
            html_url: 'https://github.com/owner/repo/pull/42',
            merged: false,
            mergeable: true,
            draft: false,
            merged_at: null
          },
          repository: {
            id: 1,
            name: 'repo',
            full_name: 'owner/repo',
            owner: { login: 'owner', id: 2 },
            private: false,
            html_url: 'https://github.com/owner/repo',
            default_branch: 'main'
          },
          sender: { login: 'TestBot', id: 100 }
        }
      };

      req.headers['x-hub-signature-256'] = SignatureHelper.createGitHubSignature(
        req.body,
        process.env.GITHUB_WEBHOOK_SECRET
      );

      await githubController.handleWebhook(req, res);

      expect(claudeService.processCommand).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
