'use client';

import { useDict } from '@web/context/dict-context';
import { SectionEmpty } from '../SectionEmpty';

/** Empty *Class notes* tab until Task 06 supplies the class notes list. */
export function ClassNotesPlaceholder() {
  const dict = useDict();
  return <SectionEmpty title={dict.notes.classPlaceholder} icon="📝" />;
}
