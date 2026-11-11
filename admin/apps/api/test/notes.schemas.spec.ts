import { createNoteSchema, notesSettingsSchema, updateNoteSchema } from '../src/notes/notes.schemas';

describe('notes request schemas', () => {
  it('trims and requires a title; defaults the body', () => {
    expect(createNoteSchema.parse({ title: '  Plan  ' })).toEqual({ title: 'Plan', body: '' });
    expect(createNoteSchema.safeParse({ title: '   ' }).success).toBe(false);
  });

  it('refuses an empty patch and an unknown field type', () => {
    expect(updateNoteSchema.safeParse({}).success).toBe(false);
    expect(updateNoteSchema.safeParse({ archived: 'yes' }).success).toBe(false);
    expect(updateNoteSchema.parse({ archived: true })).toEqual({ archived: true });
  });

  it('bounds the archive setting', () => {
    expect(notesSettingsSchema.safeParse({ archiveAfterDays: -1 }).success).toBe(false);
    expect(notesSettingsSchema.parse({ archiveAfterDays: 30 })).toEqual({ archiveAfterDays: 30 });
  });
});
