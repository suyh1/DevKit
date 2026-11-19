export type Point = [number, number];
export type Brush = {
  tool: 'pen' | 'rect' | 'ellipse' | 'arrow' | 'text';
  color: string;
  width: number;
  points: Point[];
  text: string;
};
export type Mark = Brush & { id: string; author: string };
export type BoardInfo = {
  id: string;
  name: string;
  width: number;
  height: number;
  revision: number;
  image: boolean;
  count?: number;
};
export type Board = BoardInfo & { marks: Mark[] };
export function drawMark(ctx: CanvasRenderingContext2D, mark: Brush) {
  const [x, y] = mark.points[0],
    [endX, endY] = mark.points.at(-1)!;
  const dx = endX - x,
    dy = endY - y;
  ctx.save();
  ctx.strokeStyle = mark.color;
  ctx.fillStyle = mark.color;
  ctx.lineWidth = mark.width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  switch (mark.tool) {
    case 'pen':
      ctx.moveTo(x, y);
      for (const p of mark.points.slice(1)) ctx.lineTo(...p);
      if (mark.points.length === 1) {
        ctx.arc(x, y, mark.width / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'rect':
      ctx.rect(x, y, dx, dy);
      break;
    case 'ellipse':
      ctx.ellipse(x + dx / 2, y + dy / 2, Math.abs(dx / 2), Math.abs(dy / 2), 0, 0, Math.PI * 2);
      break;
    case 'arrow': {
      ctx.moveTo(x, y);
      ctx.lineTo(endX, endY);
      const angle = Math.atan2(dy, dx),
        length = Math.min(Math.hypot(dx, dy), Math.max(12, mark.width * 4));
      for (const offset of [-0.5, 0.5]) {
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - length * Math.cos(angle + offset), endY - length * Math.sin(angle + offset));
      }
      break;
    }
    case 'text':
      ctx.font = '600 ' + (14 + mark.width * 2) + 'px sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(mark.text, x, y);
      break;
  }
  ctx.stroke();
  ctx.restore();
}
export async function prepareScreenshot(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 24 * 1048576)
    throw new Error('请选择 24 MiB 以内的 PNG、JPEG 或 WebP 截图。');
  const url = URL.createObjectURL(file),
    image = new Image();
  try {
    image.src = url;
    await image.decode();
    let scale = Math.min(1, 2400 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas'),
      ctx = canvas.getContext('2d')!;
    for (;;) {
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/png').split(',')[1];
      if (data.length <= Math.floor(2097152 / 3) * 4)
        return { image: data, width: canvas.width, height: canvas.height };
      scale *= 0.75;
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}
