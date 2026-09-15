import { createBridge } from '../../server/feishu.mjs';
const bridge = createBridge();
export default async (request) => bridge(request, process.env);
export const config = { path: '/api/class-content' };
