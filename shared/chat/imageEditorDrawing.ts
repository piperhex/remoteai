// All drawing uses image coordinates; resizing the preview never changes the exported pixels.
export const imageEditorDrawing = String.raw`
const layer = document.createElement('canvas');
const drawing = layer.getContext('2d');
const mosaic = document.createElement('canvas');
const mosaicContext = mosaic.getContext('2d');
const brush = document.createElement('canvas');
const brushContext = brush.getContext('2d');
const BRUSH_SCALE = 5;
const MOSAIC_COLUMNS = 60;

function prepareLayers() {
  layer.width = brush.width = canvas.width;
  layer.height = brush.height = canvas.height;
  const scale = MOSAIC_COLUMNS / Math.max(canvas.width, canvas.height);
  mosaic.width = Math.max(1, Math.round(canvas.width * scale));
  mosaic.height = Math.max(1, Math.round(canvas.height * scale));
  mosaicContext.drawImage(image, 0, 0, mosaic.width, mosaic.height);
}
function drawPath(target, stroke) {
  const start = stroke.points[0];
  target.beginPath();
  target.moveTo(start.x, start.y);
  stroke.points.slice(1).forEach(point => target.lineTo(point.x, point.y));
  target.stroke();
  // A tap is a dot, including taps with duplicate pointer-up coordinates.
  target.beginPath();
  target.arc(start.x, start.y, target.lineWidth / 2, 0, Math.PI * 2);
  target.fill();
}
function drawMosaic(stroke) {
  brushContext.clearRect(0, 0, brush.width, brush.height);
  brushContext.save();
  brushContext.lineWidth = stroke.width * BRUSH_SCALE;
  brushContext.lineCap = brushContext.lineJoin = 'round';
  drawPath(brushContext, stroke);
  brushContext.globalCompositeOperation = 'source-in';
  brushContext.imageSmoothingEnabled = false;
  brushContext.drawImage(mosaic, 0, 0, canvas.width, canvas.height);
  brushContext.restore();
  drawing.drawImage(brush, 0, 0);
}
function drawArrowHead(start, end, width) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const length = Math.min(width * 5, Math.hypot(end.x - start.x, end.y - start.y) / 2);
  drawing.beginPath();
  drawing.moveTo(end.x - length * Math.cos(angle - Math.PI / 6), end.y - length * Math.sin(angle - Math.PI / 6));
  drawing.lineTo(end.x, end.y);
  drawing.lineTo(end.x - length * Math.cos(angle + Math.PI / 6), end.y - length * Math.sin(angle + Math.PI / 6));
  drawing.stroke();
}
function textLines(text, maxWidth) {
  const lines = [];
  let line = '';
  for (const character of text) {
    if (character === '\n' || (line && drawing.measureText(line + character).width > maxWidth)) {
      lines.push(line);
      line = '';
    }
    if (character !== '\n') line += character;
  }
  lines.push(line);
  return lines;
}
function drawText(stroke) {
  if (!stroke.text) return;
  const fontSize = stroke.width * BRUSH_SCALE;
  drawing.font = '600 ' + fontSize + 'px system-ui, sans-serif';
  drawing.textBaseline = 'top';
  const padding = Math.min(fontSize / 4, canvas.width / 10);
  const lines = textLines(stroke.text, canvas.width - padding * 2);
  const width = Math.max(...lines.map(line => drawing.measureText(line).width));
  const x = Math.max(padding, Math.min(stroke.points[0].x, canvas.width - width - padding));
  const y = Math.max(padding, Math.min(stroke.points[0].y, canvas.height - lines.length * fontSize * 1.25));
  lines.forEach((line, index) => drawing.fillText(line, x, y + index * fontSize * 1.25));
}
function drawEllipse(start, end) {
  drawing.beginPath();
  drawing.ellipse((start.x + end.x) / 2, (start.y + end.y) / 2,
    Math.abs(end.x - start.x) / 2, Math.abs(end.y - start.y) / 2, 0, 0, Math.PI * 2);
  drawing.stroke();
}
function drawStroke(stroke) {
  drawing.save();
  drawing.strokeStyle = drawing.fillStyle = stroke.color;
  drawing.lineWidth = stroke.width;
  drawing.lineCap = drawing.lineJoin = 'round';
  const start = stroke.points[0];
  const end = stroke.points[stroke.points.length - 1];
  switch (stroke.tool) {
    case 'text': drawText(stroke); break;
    case 'mosaic': drawMosaic(stroke); break;
    case 'eraser':
      drawing.globalCompositeOperation = 'destination-out';
      drawing.lineWidth *= BRUSH_SCALE;
      drawPath(drawing, stroke);
      break;
    case 'rectangle': drawing.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y); break;
    case 'circle': drawEllipse(start, end); break;
    default:
      drawPath(drawing, stroke);
      if (stroke.tool === 'arrow') drawArrowHead(start, end, stroke.width);
  }
  drawing.restore();
}
`;
