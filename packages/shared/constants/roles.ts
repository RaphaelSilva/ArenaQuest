export const ROLES = {
  ADMIN: 'admin',
  CONTENT_CREATOR: 'content_creator',
  TUTOR: 'tutor',
  STUDENT: 'student',
} as const;

export type RoleName = typeof ROLES[keyof typeof ROLES];
