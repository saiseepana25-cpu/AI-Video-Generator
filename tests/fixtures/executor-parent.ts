import {WindowsExecutor} from '../../src/pipeline/windows-executor';
const id=process.argv[2];if(!/^[a-f0-9]{32}$/.test(id))throw new Error('Invalid fixture identity');
const job=new WindowsExecutor({id,root:process.cwd(),jobName:`Local\\VideoCraft_${id}`});
await job.prepared;job.admit();process.stdout.write('admitted\n');await job.stopped;
