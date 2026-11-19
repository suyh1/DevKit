import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { atomicFile } from './atomic-file.mjs';
import { newRecord, checkRevision, requireRecord, shortText, fail } from './collab-record.mjs';

const summary = ({ marks, ...board }) => ({ ...board, count: marks.length });
const validSize = (value) => Number.isInteger(value) && value >= 1 && value <= 4096;
function annotation(value, board) {
  if (
    !value ||
    !['pen', 'rect', 'ellipse', 'arrow', 'text'].includes(value.tool) ||
    !/^#[0-9a-f]{6}$/i.test(value.color) ||
    ![2, 4, 8].includes(value.width) ||
    !Array.isArray(value.points) ||
    value.points.length < 1 ||
    value.points.length > 1024 ||
    value.points.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 2 ||
        !p.every(Number.isFinite) ||
        p[0] < 0 ||
        p[1] < 0 ||
        p[0] > board.width ||
        p[1] > board.height,
    )
  )
    fail(400, '标注数据无效。');
  if (value.tool !== 'pen' && value.points.length !== (value.tool === 'text' ? 1 : 2)) fail(400, '标注坐标数量无效。');
  return {
    ...newRecord(),
    tool: value.tool,
    width: value.width,
    color: value.color,
    points: value.points.map((pair) => pair.map(Math.round)),
    text: value.tool === 'text' ? shortText(value.text, 240, '标注文字') : '',
  };
}
export async function boardRequest({ rows, commit, action, input, access, folder }) {
  const imageFile = (id) => path.join(folder, 'board-' + id + '.png');
  if (action === 'list') return rows.map(summary).reverse();
  if (action === 'create') {
    if (rows.length >= 80) fail(409, '最多保存 80 张白板。');
    const { width, height, image } = input;
    if (!validSize(width) || !validSize(height) || width * height > 6000000) fail(400, '画布尺寸过大。');
    const board = {
      ...newRecord(),
      name: shortText(input.name, 100, '白板名称'),
      width,
      height,
      image: !!image,
      marks: [],
    };
    if (image) {
      if (typeof image !== 'string' || image.length > 2800000) fail(413, '截图请缩小至 2 MiB 以内。');
      const bytes = Buffer.from(image, 'base64');
      if (
        bytes.length < 33 ||
        bytes.length > 2097152 ||
        !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
        bytes.toString('ascii', 12, 16) !== 'IHDR' ||
        bytes.readUInt32BE(16) !== width ||
        bytes.readUInt32BE(20) !== height
      )
        fail(400, '截图格式或尺寸无效。');
      await atomicFile(imageFile(board.id), bytes);
    }
    try {
      await commit([...rows, board]);
    } catch (error) {
      if (image) await unlink(imageFile(board.id));
      throw error;
    }
    return summary(board);
  }
  const board = requireRecord(rows, input.id);
  if (action === 'image') return board.image ? (await readFile(imageFile(board.id))).toString('base64') : '';
  if (action === 'read') return input.revision === board.revision ? null : board;
  if (action === 'remove') {
    checkRevision(board, input.revision);
    await commit(rows.filter((row) => row !== board));
    if (board.image) await unlink(imageFile(board.id));
    return {};
  }
  const next = { ...board, revision: board.revision + 1 };
  if (action === 'mark') {
    if (board.marks.length >= 1000) fail(409, '本板已有 1000 个标注，请新建白板。');
    const mark = annotation(input.mark, board);
    next.marks = [...board.marks, { ...mark, author: access.actor || '主机' }];
  } else if (action === 'erase') {
    requireRecord(board.marks, input.markId);
    next.marks = board.marks.filter((mark) => mark.id !== input.markId);
  } else if (action === 'rename') {
    checkRevision(board, input.revision);
    next.name = shortText(input.name, 100, '白板名称');
  } else fail(404, '白板操作不存在。');
  await commit(rows.map((row) => (row === board ? next : row)));
  return { revision: next.revision, markId: action === 'mark' ? next.marks.at(-1).id : undefined };
}
