import { PhotoProcessingService } from '../../../src/projects/media/photo-processing.service';

const PHOTO = { id: 'p1', projectId: 'pr1', orgId: 'o1' };
const payload = (stages: string[]) => ({ orgId: 'o1', projectId: 'pr1', photoId: 'p1', stages });

function build(existing?: { id: string; status: string; payload: unknown }) {
  const jobs = {
    enqueue: jest.fn(async (input: { payload: unknown }) => existing ?? { id: 'new', status: 'pending', payload: input.payload }),
  };
  const prisma = { job: { updateMany: jest.fn(async () => ({ count: 1 })) } };
  return { jobs, prisma, service: new PhotoProcessingService(jobs as never, prisma as never) };
}

describe('PhotoProcessingService', () => {
  it('enqueues the job for the photo with its org, subject and the three stages by default', async () => {
    const { jobs, service, prisma } = build();
    await service.enqueue(PHOTO);
    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(jobs.enqueue).toHaveBeenCalledWith({
      type: 'projects.photo.process',
      reason: 'upload',
      subjectType: 'project_photo',
      subjectId: 'p1',
      orgId: 'o1',
      payload: payload(['enhance', 'crops', 'og']),
    });
    expect(prisma.job.updateMany).not.toHaveBeenCalled();
  });

  it('uses the rerun reason when the stages do not include enhance', async () => {
    const { jobs, service } = build();
    await service.enqueue(PHOTO, ['crops']);
    expect(jobs.enqueue.mock.calls[0][0]).toMatchObject({ reason: 'rerun', payload: payload(['crops']) });
  });

  it('merges extra stages into a pending job that is already queued', async () => {
    const { jobs, service, prisma } = build({ id: 'j1', status: 'pending', payload: payload(['og']) });
    await service.enqueue(PHOTO, ['crops']);
    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(prisma.job.updateMany).toHaveBeenCalledWith({ where: { id: 'j1', status: 'pending' }, data: { payload: payload(['og', 'crops']) } });
  });

  it('queues a follow-up behind a running job that lacks the stages', async () => {
    const { jobs, service, prisma } = build({ id: 'j1', status: 'running', payload: payload(['og']) });
    await service.enqueue(PHOTO, ['og', 'crops']);
    expect(prisma.job.updateMany).not.toHaveBeenCalled();
    expect(jobs.enqueue).toHaveBeenCalledTimes(2);
    expect(jobs.enqueue.mock.calls[1][0]).toMatchObject({ skipDedup: true, payload: payload(['crops']) });
  });

  it('does nothing extra when the queued job already covers the stages, or for an empty list', async () => {
    const covered = build({ id: 'j1', status: 'running', payload: payload(['enhance', 'crops', 'og']) });
    await covered.service.enqueue(PHOTO, ['crops']);
    expect(covered.jobs.enqueue).toHaveBeenCalledTimes(1);
    const empty = build();
    await empty.service.enqueue(PHOTO, []);
    expect(empty.jobs.enqueue).not.toHaveBeenCalled();
  });
});
