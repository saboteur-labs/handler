import { describe, expect, it } from 'vitest';

import { agentIdentity, identitiesEqual, identityKey, type AgentIdentity } from './identity';
import { repoSource, userSource } from './sources/source';

describe('agent identity (Req 8)', () => {
  describe('identityKey', () => {
    it('serializes the tuple as a fixed-order JSON array (pinned format)', () => {
      const identity: AgentIdentity = { sourceType: 'repo', sourcePath: '/x/y', name: 'reviewer' };
      expect(identityKey(identity)).toBe('["repo","/x/y","reviewer"]');
    });

    it('is deterministic for equal tuples', () => {
      const a: AgentIdentity = { sourceType: 'user', sourcePath: '/home/u', name: 'helper' };
      const b: AgentIdentity = { sourceType: 'user', sourcePath: '/home/u', name: 'helper' };
      expect(identityKey(a)).toBe(identityKey(b));
    });

    it('does not alias when a path contains the JSON delimiter characters', () => {
      const a: AgentIdentity = { sourceType: 'repo', sourcePath: '/a", "b', name: 'n' };
      const b: AgentIdentity = { sourceType: 'repo', sourcePath: '/a', name: 'b", "n' };
      expect(identityKey(a)).not.toBe(identityKey(b));
    });
  });

  describe('identitiesEqual', () => {
    it('is true for the same name in the same source', () => {
      const a: AgentIdentity = { sourceType: 'repo', sourcePath: '/repo', name: 'reviewer' };
      const b: AgentIdentity = { sourceType: 'repo', sourcePath: '/repo', name: 'reviewer' };
      expect(identitiesEqual(a, b)).toBe(true);
    });

    it('distinguishes the same name across different source types', () => {
      const a: AgentIdentity = { sourceType: 'user', sourcePath: '/p', name: 'n' };
      const b: AgentIdentity = { sourceType: 'repo', sourcePath: '/p', name: 'n' };
      expect(identitiesEqual(a, b)).toBe(false);
    });

    it('distinguishes the same name across different source paths', () => {
      const a: AgentIdentity = { sourceType: 'repo', sourcePath: '/alpha', name: 'n' };
      const b: AgentIdentity = { sourceType: 'repo', sourcePath: '/beta', name: 'n' };
      expect(identitiesEqual(a, b)).toBe(false);
    });

    it('distinguishes different names in the same source', () => {
      const a: AgentIdentity = { sourceType: 'repo', sourcePath: '/repo', name: 'one' };
      const b: AgentIdentity = { sourceType: 'repo', sourcePath: '/repo', name: 'two' };
      expect(identitiesEqual(a, b)).toBe(false);
    });
  });

  describe('agentIdentity', () => {
    it('builds an identity from a source and name, keyed on the source root', () => {
      const source = repoSource('/handler-it/repo');
      const identity = agentIdentity(source, 'helper');
      expect(identity.sourceType).toBe('repo');
      expect(identity.sourcePath).toBe(source.root);
      expect(identity.name).toBe('helper');
    });

    it('makes identically-named agents in different repo sources distinct', () => {
      const alpha = agentIdentity(repoSource('/handler-it/alpha'), 'shared');
      const beta = agentIdentity(repoSource('/handler-it/beta'), 'shared');
      expect(identitiesEqual(alpha, beta)).toBe(false);
    });

    it('distinguishes a repo agent from a user agent of the same name', () => {
      const repo = agentIdentity(repoSource('/handler-it/repo'), 'shared');
      const user = agentIdentity(userSource('/handler-it/home'), 'shared');
      expect(identitiesEqual(repo, user)).toBe(false);
    });

    it('is stable: the same source and name produce an equal identity', () => {
      const source = repoSource('/handler-it/repo');
      expect(identitiesEqual(agentIdentity(source, 'x'), agentIdentity(source, 'x'))).toBe(true);
    });
  });
});
