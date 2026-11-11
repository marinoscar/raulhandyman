/** Job type of the copy suggestion. PERMANENT once jobs of this type exist: never rename it. */
export const AI_SUGGEST_JOB = 'projects.ai.suggest';
/** `jobs.subject_type` of a suggest job (the subject is the project: one active job per project). */
export const AI_SUGGEST_SUBJECT_TYPE = 'project';

/** Job type of the photo retouch. PERMANENT once jobs of this type exist: never rename it. */
export const PHOTO_RETOUCH_JOB = 'projects.photo.retouch';
/** `jobs.subject_type` of a retouch job (the subject is the photo). */
export const PHOTO_RETOUCH_SUBJECT_TYPE = 'project_photo';

/** The most photos sent to the model in one suggestion. */
export const MAX_SUGGEST_PHOTOS = 8;
/** The rendition of a photo that is sent to the model (long edge 1024). */
export const AI_RENDITION_KEY = 'ai1024';
