import { describe, expect, it } from 'vitest';
import { isCompanyUsable, trialDaysLeft } from './db-types';
import { formatCnpj, safeNext } from './format';

const now = new Date('2026-10-17T12:00:00Z');
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();

describe('isCompanyUsable', () => {
  it('libera empresa ativa mesmo com teste vencido', () => {
    expect(isCompanyUsable({ status: 'active', trial_ends_at: inDays(-90) }, now)).toBe(true);
  });
  it('libera teste dentro do prazo e bloqueia depois', () => {
    expect(isCompanyUsable({ status: 'trial', trial_ends_at: inDays(3) }, now)).toBe(true);
    expect(isCompanyUsable({ status: 'trial', trial_ends_at: inDays(-1) }, now)).toBe(false);
  });
  it('bloqueia empresa bloqueada', () => {
    expect(isCompanyUsable({ status: 'blocked', trial_ends_at: inDays(10) }, now)).toBe(false);
  });
});

describe('trialDaysLeft', () => {
  it('arredonda para cima e nunca fica negativo', () => {
    expect(trialDaysLeft({ trial_ends_at: inDays(29.2) }, now)).toBe(30);
    expect(trialDaysLeft({ trial_ends_at: inDays(-5) }, now)).toBe(0);
  });
});

describe('formatCnpj', () => {
  it('aplica a máscara progressivamente', () => {
    expect(formatCnpj('12345678000195')).toBe('12.345.678/0001-95');
    expect(formatCnpj('12345')).toBe('12.345');
    expect(formatCnpj('12.345.678/0001-95999')).toBe('12.345.678/0001-95');
  });
});

describe('safeNext', () => {
  it('aceita só caminhos internos', () => {
    expect(safeNext('/empresa')).toBe('/empresa');
    expect(safeNext('//evil.com')).toBe('/');
    expect(safeNext('https://evil.com')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});
