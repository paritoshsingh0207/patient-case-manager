import { describe, expect, it } from 'vitest';
import { hasWorkspaceAccess, matchesLoginRole } from '../services/accessService';
import type { PractitionerAccess } from '../types';
const profile=(role:PractitionerAccess['role'],active=true):PractitionerAccess=>({uid:'test-uid',role,active});
describe('role-specific sign-in',()=>{
  it('accepts doctor login only for a doctor',()=>{
    expect(matchesLoginRole(profile('doctor'),'doctor')).toBe(true);
    expect(matchesLoginRole(profile('doctor'),'admin')).toBe(false);
  });
  it('accepts admin login only for an admin',()=>{
    expect(matchesLoginRole(profile('admin'),'admin')).toBe(true);
    expect(matchesLoginRole(profile('admin'),'doctor')).toBe(false);
  });
  it('resumes a verified existing Firebase session after refresh',()=>{
    expect(matchesLoginRole(profile('admin'),null)).toBe(true);
  });
  it('rejects inactive and unknown account access',()=>{
    expect(hasWorkspaceAccess(profile('doctor',false))).toBe(false);
    expect(hasWorkspaceAccess(profile('unknown'))).toBe(false);
    expect(hasWorkspaceAccess(null)).toBe(false);
  });
});
