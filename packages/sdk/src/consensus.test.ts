import { describe, it, expect } from 'vitest';
import {
  getUpgradeName,
  normalizeBranchId,
  CONSENSUS_BRANCH_UPGRADES,
  getExpectedBranchId,
} from './consensus.js';

describe('Consensus Upgrade Name Helper', () => {
  it('maps known branch IDs correctly regardless of case, 0x prefix, or numeric form', () => {
    // NU7 (0x77190ad9)
    expect(getUpgradeName('77190ad9')).toBe('NU7');
    expect(getUpgradeName('0x77190ad9')).toBe('NU7');
    expect(getUpgradeName('0X77190AD9')).toBe('NU7');
    expect(getUpgradeName(0x77190ad9)).toBe('NU7');

    // NU6.3 (0x37a5165b)
    expect(getUpgradeName('37a5165b')).toBe('NU6.3');
    expect(getUpgradeName('0x37a5165b')).toBe('NU6.3');
    expect(getUpgradeName(0x37a5165b)).toBe('NU6.3');

    // NU6 (0xc8e71055)
    expect(getUpgradeName('c8e71055')).toBe('NU6');

    // NU5 (0xc2d6d0b4)
    expect(getUpgradeName('c2d6d0b4')).toBe('NU5');

    // Earlier upgrades
    expect(getUpgradeName('e9ff75a6')).toBe('Canopy');
    expect(getUpgradeName('f5b9230b')).toBe('Heartwood');
    expect(getUpgradeName('2bb40e60')).toBe('Blossom');
    expect(getUpgradeName('76b809bb')).toBe('Sapling');
    expect(getUpgradeName('5ba81b19')).toBe('Overwinter');
    expect(getUpgradeName('00000000')).toBe('Sprout');
    expect(getUpgradeName(0)).toBe('Sprout');
  });

  it('formats unknown branch IDs as Unknown (0x...)', () => {
    expect(getUpgradeName('deadbeef')).toBe('Unknown (0xdeadbeef)');
    expect(getUpgradeName('0xdeadbeef')).toBe('Unknown (0xdeadbeef)');
    expect(getUpgradeName(0x12345678)).toBe('Unknown (0x12345678)');
  });

  it('handles null, undefined, or empty inputs gracefully', () => {
    expect(getUpgradeName(null)).toBe('Unknown');
    expect(getUpgradeName(undefined)).toBe('Unknown');
    expect(getUpgradeName('')).toBe('Unknown');
    expect(getUpgradeName('   ')).toBe('Unknown');
  });

  it('normalizes branch IDs to 8-character lowercase hex', () => {
    expect(normalizeBranchId('77190ad9')).toBe('77190ad9');
    expect(normalizeBranchId('0x77190ad9')).toBe('77190ad9');
    expect(normalizeBranchId('0X77190AD9')).toBe('77190ad9');
    expect(normalizeBranchId(0x37a5165b)).toBe('37a5165b');
    expect(normalizeBranchId('0')).toBe('00000000');
  });

  it('retrieves expected branch id for known testnet and regtest heights', () => {
    // Testnet NU7 activation is at 4465026, tip is 4548000+
    const testnetNu7 = getExpectedBranchId('testnet', 4548000);
    expect(testnetNu7).toBe('77190ad9');

    // Regtest NU6.3
    const regtestNu6_3 = getExpectedBranchId('regtest', 10);
    expect(regtestNu6_3).toBe('37a5165b');

    // Regtest NU7
    const regtestNu7 = getExpectedBranchId('regtest-nu7', 10);
    expect(regtestNu7).toBe('77190ad9');
  });
});
