// Set up environment variables before requiring modules
process.env.BOT_USERNAME = '@TestBot';
process.env.NODE_ENV = 'test';
process.env.GITHUB_TOKEN = 'ghp_test_token'; // Use token format that passes validation

// Mock dependencies
jest.mock('child_process', () => ({
  execFileSync: jest.fn().mockReturnValue('mocked output'),
  execFile: jest.fn(),
  exec: jest.fn()
}));

jest.mock('util', () => ({
  promisify: jest.fn(fn => {
    if (fn.name === 'execFile') {
      return jest.fn().mockResolvedValue({
        stdout: 'Claude response from container',
        stderr: ''
      });
    }
    return fn;
  })
}));

jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../../../src/utils/sanitize', () => ({
  sanitizeBotMentions: jest.fn(input => input)
}));

jest.mock('../../../src/utils/secureCredentials', () => ({
  get: jest.fn(key => {
    if (key === 'GITHUB_TOKEN') return 'ghp_test_github_token_mock123456789012345678901234';
    if (key === 'ANTHROPIC_API_KEY')
      return 'sk-ant-test-anthropic-key12345678901234567890123456789';
    return null;
  })
}));

jest.mock('../../../src/services/githubService', () => ({
  fetchRepoInstructions: jest.fn()
}));

// Now require the module under test
const { execFileSync } = require('child_process');
const { promisify } = require('util');
const { sanitizeBotMentions } = require('../../../src/utils/sanitize');
const claudeService =
  require('../../../src/services/claudeService').default ||
  require('../../../src/services/claudeService');
const { fetchRepoInstructions } = require('../../../src/services/githubService');

describe('Claude Service', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    // Ensure test mode is restored (some tests set NODE_ENV to 'production' and may not restore it)
    process.env.NODE_ENV = 'test';
    // Default: no repo instructions
    fetchRepoInstructions.mockResolvedValue(null);
  });

  test('processCommand should handle test mode correctly', async () => {
    // Force test mode
    process.env.NODE_ENV = 'test';

    const result = await claudeService.processCommand({
      repoFullName: 'test/repo',
      issueNumber: 123,
      command: 'Test command',
      isPullRequest: false
    });

    // Verify test mode response
    expect(result).toContain("Hello! I'm Claude responding to your request.");
    expect(result).toContain('test/repo');
    expect(sanitizeBotMentions).toHaveBeenCalled();

    // Verify no Docker commands were executed
    expect(execFileSync).not.toHaveBeenCalled();
  });

  test('processCommand should properly set up Docker command in production mode', async () => {
    // Mock for this test only
    const originalProcessCommand = claudeService.processCommand;

    // Override the actual function with a test implementation
    claudeService.processCommand = async options => {
      // Set production mode for this function
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      // Mock dependencies needed in production mode
      execFileSync.mockImplementation((cmd, args, _options) => {
        if (args[0] === 'inspect') return '{}';
        return 'mocked output';
      });

      // Configure execFileAsync mock
      const execFileAsync = promisify(require('child_process').execFile);
      execFileAsync.mockResolvedValue({
        stdout: 'Claude response from container',
        stderr: ''
      });

      // Call the original implementation to test it
      const result = await originalProcessCommand(options);

      // Restore env
      process.env.NODE_ENV = originalNodeEnv;

      return result;
    };

    try {
      // Call the overridden function
      await claudeService.processCommand({
        repoFullName: 'test/repo',
        issueNumber: 123,
        command: 'Test command',
        isPullRequest: false
      });

      // Our assertions happen in the override function
      // We just need to verify the execFileSync was called
      expect(execFileSync).toHaveBeenCalled();
    } finally {
      // Restore the original function
      claudeService.processCommand = originalProcessCommand;
    }
  });

  test('processCommand should mount authentication directory correctly', async () => {
    // Save original function for restoration
    const originalProcessCommand = claudeService.processCommand;

    // Create a testing implementation that checks Docker args
    claudeService.processCommand = async options => {
      // Set test environment variables
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      process.env.CLAUDE_AUTH_HOST_DIR = '/test/auth/dir';

      // Mock the Docker inspect to succeed
      execFileSync.mockImplementation((cmd, args, _options) => {
        if (args[0] === 'inspect') return '{}';
        return 'mocked output';
      });

      // Configure execFileAsync mock to capture Docker args
      const execFileAsync = promisify(require('child_process').execFile);
      execFileAsync.mockImplementation(async (cmd, args, _options) => {
        // Check that authentication directory is mounted correctly
        const dockerArgs = args;
        const volumeArgIndex = dockerArgs.findIndex(arg => arg === '-v');
        if (volumeArgIndex !== -1) {
          const volumeMount = dockerArgs[volumeArgIndex + 1];
          expect(volumeMount).toBe('/test/auth/dir:/home/node/.claude');
        }

        return {
          stdout: 'Claude response from container',
          stderr: ''
        };
      });

      // Call the original implementation to test it
      const result = await originalProcessCommand(options);

      // Restore env
      process.env.NODE_ENV = originalNodeEnv;
      delete process.env.CLAUDE_AUTH_HOST_DIR;

      return result;
    };

    try {
      // Call the overridden function
      await claudeService.processCommand({
        repoFullName: 'test/repo',
        issueNumber: 123,
        command: 'Test command',
        isPullRequest: false
      });

      // Verify execFileAsync was called (authentication mount logic executed)
      const execFileAsync = promisify(require('child_process').execFile);
      expect(execFileAsync).toHaveBeenCalled();
    } finally {
      // Restore the original function
      claudeService.processCommand = originalProcessCommand;
    }
  });

  test('processCommand should handle errors properly', async () => {
    // Save original function for restoration
    const originalProcessCommand = claudeService.processCommand;

    // Create a testing implementation
    claudeService.processCommand = async options => {
      // Set test environment variables
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      // Mock the Docker inspect to succeed
      execFileSync.mockImplementation((cmd, args, _options) => {
        if (args[0] === 'inspect') return '{}';
        if (args[0] === 'logs') return 'error logs';
        if (args[0] === 'kill') return '';
        return 'mocked output';
      });

      // Mock execFileAsync to throw an error
      const execFileAsync = promisify(require('child_process').execFile);
      execFileAsync.mockRejectedValue({
        message: 'Docker execution failed',
        stderr: 'Error: container exited with non-zero status',
        stdout: ''
      });

      // Throw error from original implementation
      await originalProcessCommand(options);

      // Restore environment
      process.env.NODE_ENV = originalNodeEnv;
    };

    try {
      // Call the function and expect it to throw
      await expect(
        claudeService.processCommand({
          repoFullName: 'test/repo',
          issueNumber: 123,
          command: 'Test command',
          isPullRequest: false
        })
      ).rejects.toThrow();

      // Verify execFileSync was called
      expect(execFileSync).toHaveBeenCalled();
    } finally {
      // Restore original function
      claudeService.processCommand = originalProcessCommand;
    }
  });

  describe('repo instructions integration', () => {
    it('should append repo instructions to prompt when available', async () => {
      fetchRepoInstructions.mockResolvedValue('# Custom Instructions\nDo the thing.');

      await claudeService.processCommand({
        repoFullName: 'owner/repo',
        issueNumber: 1,
        command: 'Fix the bug',
        isPullRequest: false,
        branchName: null,
        operationType: 'default'
      });

      expect(fetchRepoInstructions).toHaveBeenCalledWith('owner', 'repo');
    });

    it('should not fail when repo instructions are not found', async () => {
      fetchRepoInstructions.mockResolvedValue(null);

      const result = await claudeService.processCommand({
        repoFullName: 'owner/repo',
        issueNumber: 1,
        command: 'Fix the bug',
        isPullRequest: false,
        branchName: null,
        operationType: 'default'
      });

      expect(fetchRepoInstructions).toHaveBeenCalledWith('owner', 'repo');
      expect(result).toBeDefined();
    });
  });

  describe('CI verification prompt', () => {
    /**
     * Helper: run processCommand in production mode and return the COMMAND env var
     * (which contains the full prompt) from the Docker args.
     */
    async function getPromptFromDockerArgs(options, envOverrides = {}) {
      const originalProcessCommand = claudeService.processCommand;
      let capturedPrompt = null;

      claudeService.processCommand = async opts => {
        const originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';

        // Apply env overrides
        const savedEnv = {};
        for (const [key, value] of Object.entries(envOverrides)) {
          savedEnv[key] = process.env[key];
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }

        execFileSync.mockImplementation((cmd, args, _options) => {
          if (args[0] === 'inspect') return '{}';
          return 'mocked output';
        });

        const execFileAsync = promisify(require('child_process').execFile);
        execFileAsync.mockImplementation(async (cmd, args, _options) => {
          const commandArg = args.find(
            arg => typeof arg === 'string' && arg.startsWith('COMMAND=')
          );
          if (commandArg) {
            capturedPrompt = commandArg.replace('COMMAND=', '');
          }
          return { stdout: 'Claude response', stderr: '' };
        });

        try {
          await originalProcessCommand(opts);
        } finally {
          process.env.NODE_ENV = originalNodeEnv;
          for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) {
              delete process.env[key];
            } else {
              process.env[key] = value;
            }
          }
        }
      };

      try {
        await claudeService.processCommand(options);
        return capturedPrompt;
      } finally {
        claudeService.processCommand = originalProcessCommand;
      }
    }

    it('should include CI verification instructions in default prompt', async () => {
      const prompt = await getPromptFromDockerArgs(
        {
          repoFullName: 'owner/repo',
          issueNumber: 1,
          command: 'Fix the bug',
          isPullRequest: false,
          branchName: null,
          operationType: 'default'
        },
        { PR_HUMAN_REVIEWER: undefined }
      );

      expect(prompt).toContain('Post-PR CI Verification Loop');
      expect(prompt).toContain('gh pr checks --watch');
      expect(prompt).toContain('up to 3 times');
      expect(prompt).toContain('gh pr comment');
    });

    it('should include reviewer request when PR_HUMAN_REVIEWER is set', async () => {
      const prompt = await getPromptFromDockerArgs(
        {
          repoFullName: 'owner/repo',
          issueNumber: 1,
          command: 'Fix the bug',
          isPullRequest: false,
          branchName: null,
          operationType: 'default'
        },
        { PR_HUMAN_REVIEWER: 'testreviewer' }
      );

      expect(prompt).toContain('gh pr edit <PR_NUMBER> --add-reviewer testreviewer');
    });

    it('should omit reviewer request when PR_HUMAN_REVIEWER is not set', async () => {
      const prompt = await getPromptFromDockerArgs(
        {
          repoFullName: 'owner/repo',
          issueNumber: 1,
          command: 'Fix the bug',
          isPullRequest: false,
          branchName: null,
          operationType: 'default'
        },
        { PR_HUMAN_REVIEWER: undefined }
      );

      expect(prompt).not.toContain('--add-reviewer');
    });

    it('should not include CI verification in auto-tagging prompt', async () => {
      const prompt = await getPromptFromDockerArgs(
        {
          repoFullName: 'owner/repo',
          issueNumber: 1,
          command: 'Auto-tag this issue',
          isPullRequest: false,
          branchName: null,
          operationType: 'auto-tagging'
        },
        { PR_HUMAN_REVIEWER: 'testreviewer' }
      );

      expect(prompt).not.toContain('Post-PR CI Verification Loop');
    });
  });

  test('processCommand should handle long commands properly', async () => {
    // Save original function for restoration
    const originalProcessCommand = claudeService.processCommand;

    // Create a testing implementation that checks for long command handling
    claudeService.processCommand = async options => {
      // Set up test environment
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      // Mock the Docker inspect to succeed
      execFileSync.mockImplementation((cmd, args, _options) => {
        if (args[0] === 'inspect') return '{}';
        return 'mocked output';
      });

      // Configure execFileAsync mock
      const execFileAsync = promisify(require('child_process').execFile);
      execFileAsync.mockResolvedValue({
        stdout: 'Claude response for long command',
        stderr: ''
      });

      // Call the original implementation
      const result = await originalProcessCommand(options);

      // Verify Docker was called with the command as an environment variable
      expect(execFileAsync).toHaveBeenCalled();
      const dockerArgs = execFileAsync.mock.calls[0][1];

      // Check that COMMAND env var is present in the docker args
      // The format is ['-e', 'COMMAND=value']
      const commandEnvIndex = dockerArgs.findIndex(
        arg => typeof arg === 'string' && arg.startsWith('COMMAND=')
      );
      expect(commandEnvIndex).toBeGreaterThan(-1);

      // Restore environment
      process.env.NODE_ENV = originalNodeEnv;

      return result;
    };

    try {
      // Call the function with a long command
      const longCommand = 'A'.repeat(1000);

      const result = await claudeService.processCommand({
        repoFullName: 'test/repo',
        issueNumber: 123,
        command: longCommand,
        isPullRequest: false
      });

      // Verify we got a response
      expect(result).toBe('Claude response for long command');
    } finally {
      // Restore original function
      claudeService.processCommand = originalProcessCommand;
    }
  });
});
