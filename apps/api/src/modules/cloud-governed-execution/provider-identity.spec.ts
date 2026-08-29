import {
  extractProviderIdentity,
} from './provider-identity';

describe('extractProviderIdentity (OB002D-MEDIUM-PROVIDER-IDENTITY)', () => {
  it('extracts a unique sanitized identity from the launcher stream + runtime selection', () => {
    const output = [
      'level=INFO run=x message="session started" session.id=abc',
      'level=INFO run=x message=stream providerID=openai modelID=gpt-5.6-terra-fast session.id=abc agent=build mode=primary',
      'level=INFO run=x message="llm runtime selected" llm.provider=openai llm.model=gpt-5.6-terra-fast',
      'level=INFO run=x message="task completed" task.id=1',
    ].join('\n');
    const parsed = extractProviderIdentity(output);
    expect(parsed).toEqual({
      ok: true,
      identity: { providerId: 'openai', modelId: 'gpt-5.6-terra-fast' },
    });
  });

  it('fails closed with MISSING when no coding-agent stream identity exists', () => {
    const parsed = extractProviderIdentity('level=INFO run=x message="agent init" agent=general\n');
    expect(parsed).toEqual({ ok: false, code: 'PROVIDER_IDENTITY_MISSING' });
  });

  it('fails closed with MISSING on empty output', () => {
    expect(extractProviderIdentity('')).toEqual({ ok: false, code: 'PROVIDER_IDENTITY_MISSING' });
  });

  it('fails closed with AMBIGUOUS on multiple distinct runtime selections', () => {
    const output = [
      'level=INFO run=x message=stream providerID=openai modelID=gpt-5.6-terra-fast agent=build mode=primary',
      'level=INFO run=x message="llm runtime selected" llm.provider=openai llm.model=gpt-5.6-terra-fast',
      'level=INFO run=x message="llm runtime selected" llm.provider=opencode llm.model=big-pickle',
    ].join('\n');
    expect(extractProviderIdentity(output)).toEqual({ ok: false, code: 'PROVIDER_IDENTITY_AMBIGUOUS' });
  });

  it('fails closed with AMBIGUOUS when the runtime selection contradicts the build identity', () => {
    const output = [
      'level=INFO run=x message=stream providerID=openai modelID=gpt-5.6-terra-fast agent=build mode=primary',
      'level=INFO run=x message="llm runtime selected" llm.provider=opencode llm.model=big-pickle',
    ].join('\n');
    expect(extractProviderIdentity(output)).toEqual({ ok: false, code: 'PROVIDER_IDENTITY_AMBIGUOUS' });
  });

  it('fails closed with AMBIGUOUS on multiple distinct build stream identities', () => {
    const output = [
      'level=INFO run=x message=stream providerID=openai modelID=gpt-5.6-terra-fast agent=build mode=primary',
      'level=INFO run=x message=stream providerID=opencode modelID=big-pickle agent=build mode=primary',
    ].join('\n');
    expect(extractProviderIdentity(output)).toEqual({ ok: false, code: 'PROVIDER_IDENTITY_AMBIGUOUS' });
  });

  it('accepts identities with the exact conservative charsets (., -: / for model)', () => {
    const output = [
      'level=INFO run=x message=stream providerID=auth.openai-saas:stable modelID=vito/gpt-5.6:terra-fast agent=build mode=primary',
    ].join('\n');
    const parsed = extractProviderIdentity(output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.identity).toEqual({
        providerId: 'auth.openai-saas:stable',
        modelId: 'vito/gpt-5.6:terra-fast',
      });
    }
  });

  it('CRITICAL: smuggled/oversized/malformed identity tokens fail closed AMBIGUOUS', () => {
    const attempts: string[] = [
      `level=INFO run=x message=stream providerID=sk-injected;" rm -rf / modelID=gpt agent=build mode=primary`,
      `level=INFO run=x message=stream providerID=${'a'.repeat(129)} modelID=gpt agent=build mode=primary`,
      `level=INFO run=x message=stream agent=build mode=primary`,
      `level=INFO run=x message=stream providerID=openai agent=build mode=primary`,
    ];
    for (const line of attempts) {
      expect(extractProviderIdentity(line)).toEqual({ ok: false, code: 'PROVIDER_IDENTITY_AMBIGUOUS' });
    }
  });

  it('a smuggled runtime token that fails validation also fails closed', () => {
    const output = [
      'level=INFO run=x message=stream providerID=openai modelID=gpt-5.6-terra-fast agent=build mode=primary',
      'level=INFO run=x message="llm runtime selected" llm.provider=openai llm.model=sk-injected;"bad',
    ].join('\n');
    expect(extractProviderIdentity(output)).toEqual({ ok: false, code: 'PROVIDER_IDENTITY_AMBIGUOUS' });
  });
});