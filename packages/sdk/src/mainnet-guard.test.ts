import { describe, it, expect } from 'vitest';
import { accountFromMnemonic } from './keys.js';
import { dev } from './dev.js';
import { KNOWN_TEST_MNEMONICS } from './constants.js';

describe('Mainnet Guard & Shared Fixture Mnemonics', () => {
  it('shares the exact same list of 10 test mnemonics between dev and constants', () => {
    expect(KNOWN_TEST_MNEMONICS.length).toBe(10);
    expect(dev.fixtures.mnemonics).toBe(KNOWN_TEST_MNEMONICS);
  });

  it('rejects every single fixture mnemonic on mainnet via accountFromMnemonic', () => {
    for (let i = 0; i < KNOWN_TEST_MNEMONICS.length; i++) {
      const mnemonic = KNOWN_TEST_MNEMONICS[i];
      expect(() => {
        accountFromMnemonic(mnemonic, 0, 'mainnet');
      }).toThrow(/Using known test fixture mnemonics on mainnet is strictly prohibited/);

      // Verify case insensitivity and whitespace trimming
      expect(() => {
        accountFromMnemonic(`  ${mnemonic.toUpperCase()}  `, 0, 'mainnet');
      }).toThrow(/Using known test fixture mnemonics on mainnet is strictly prohibited/);
    }
  });

  it('rejects every fixture index on mainnet via dev.fixtures.account', () => {
    for (let i = 0; i < KNOWN_TEST_MNEMONICS.length + 5; i++) {
      expect(() => {
        dev.fixtures.account(i, 'mainnet');
      }).toThrow(/Test fixture mnemonics are publicly known and strictly prohibited on mainnet/);
    }
  });
});
