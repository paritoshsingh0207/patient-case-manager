import { doc, onSnapshot, type Firestore } from 'firebase/firestore';
import type { PractitionerAccess } from '../types';

export function subscribePractitionerAccess(
  db: Firestore,
  uid: string,
  onChange: (profile: PractitionerAccess | null) => void,
  onError: (error: Error) => void,
) {
  return onSnapshot(
    doc(db, 'users', uid),
    (snapshot) => {
      if (!snapshot.exists()) {
        onChange(null);
        return;
      }

      const data = snapshot.data();
      const role =
        data.role === 'admin'
          ? 'admin'
          : data.role === 'doctor' || data.role === 'practitioner'
            ? 'doctor'
            : 'unknown';

      onChange({
        uid: snapshot.id,
        active: data.active === true,
        role,
        displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
        email: typeof data.email === 'string' ? data.email : undefined,
      });
    },
    onError,
  );
}

export type LoginRole = 'admin' | 'doctor';
/** The login selector never grants permissions; Firestore decides the real role. */
export function matchesLoginRole(profile: PractitionerAccess | null, selected: LoginRole | null) {
  return selected === null || profile?.role === selected;
}

export function hasWorkspaceAccess(profile: PractitionerAccess | null) {
  return Boolean(profile?.active && (profile.role === 'doctor' || profile.role === 'admin'));
}
