import { describe, expect, it } from 'vitest';
import {
  KB_ROLES,
  createKnowledgeBaseSchema,
  kbRoleSatisfies,
  kbRoleSchema,
} from './knowledge-base.js';

describe('knowledge base roles', () => {
  it('defines all four roles least → most privileged', () => {
    expect(KB_ROLES).toEqual(['viewer', 'editor', 'admin', 'owner']);
    for (const role of KB_ROLES) expect(kbRoleSchema.parse(role)).toBe(role);
  });

  it('orders privilege via kbRoleSatisfies', () => {
    expect(kbRoleSatisfies('owner', 'admin')).toBe(true);
    expect(kbRoleSatisfies('admin', 'editor')).toBe(true);
    expect(kbRoleSatisfies('viewer', 'viewer')).toBe(true);
    expect(kbRoleSatisfies('viewer', 'editor')).toBe(false);
    expect(kbRoleSatisfies('editor', 'admin')).toBe(false);
  });
});

describe('createKnowledgeBaseSchema', () => {
  it('trims and requires a non-empty name', () => {
    expect(createKnowledgeBaseSchema.parse({ name: '  KB  ' }).name).toBe('KB');
    expect(createKnowledgeBaseSchema.safeParse({ name: '' }).success).toBe(false);
    expect(createKnowledgeBaseSchema.safeParse({ name: '   ' }).success).toBe(false);
  });
});
