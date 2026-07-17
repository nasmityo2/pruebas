process.env.NODE_ENV = 'test';
process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.TRIAL_SECRET_KEY ||= 'stokko-test-trial-key-32-bytes-minimum';
process.env.HIST_SECRET ||= 'stokko-test-history-key-32-bytes-minimum';
process.env.HASH_SECRET ||= 'stokko-test-password-key-32-bytes-minimum';
