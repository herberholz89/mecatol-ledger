import { describe, expect, it } from 'vitest';
import { parseAdminEmails, signInCodeSchema, signInEmailSchema, updateMeSchema } from './auth.js';

describe('auth schemas', () => {
  it('normalizes the sign-in email', () => {
    expect(signInEmailSchema.parse({ email: '  Me@Example.COM ' })).toEqual({ email: 'me@example.com' });
    expect(signInEmailSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });

  it('accepts only 6-digit codes', () => {
    expect(signInCodeSchema.parse({ otp: ' 012345 ' })).toEqual({ otp: '012345' });
    expect(signInCodeSchema.safeParse({ otp: '12345' }).success).toBe(false);
    expect(signInCodeSchema.safeParse({ otp: '12345a' }).success).toBe(false);
  });

  it('trims display names and rejects blank or long ones', () => {
    expect(updateMeSchema.parse({ displayName: '  Cody ' })).toEqual({ displayName: 'Cody' });
    expect(updateMeSchema.safeParse({ displayName: '   ' }).success).toBe(false);
    expect(updateMeSchema.safeParse({ displayName: 'x'.repeat(41) }).success).toBe(false);
  });

  it('parses ADMIN_EMAILS', () => {
    expect(parseAdminEmails(' A@x.com, ,b@Y.com ')).toEqual(new Set(['a@x.com', 'b@y.com']));
    expect(parseAdminEmails(undefined).size).toBe(0);
  });
});
