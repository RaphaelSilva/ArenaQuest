-- Seed roles
INSERT OR IGNORE INTO roles (id, name, description, created_at) VALUES
  ('bace0701-15e3-5144-97c5-47487d543032', 'admin',           'Full platform access',         CURRENT_TIMESTAMP),
  ('3318927d-8b5e-52d9-a145-2e4323919ed6', 'content_creator', 'Can create/edit content',      CURRENT_TIMESTAMP),
  ('32a5cab1-e66f-5d23-a80d-80cfa927d057', 'tutor',           'Can monitor student progress',  CURRENT_TIMESTAMP),
  ('bf3d0f1d-7d77-5151-922e-b87dff0fa7ad', 'student',         'Can consume content and tasks', CURRENT_TIMESTAMP);
