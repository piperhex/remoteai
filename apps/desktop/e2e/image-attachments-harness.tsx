import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ImageAttachments } from '../src/pages/codexGui/ImageAttachments';
import type { DraftImage } from '../src/pages/codexGui/draftImages';
import '../src/styles.css';

function initialImages(): DraftImage[] {
  const params = new URLSearchParams(location.search);
  const canvas = document.createElement('canvas');
  canvas.width = params.has('wide') ? 1600 : 800;
  canvas.height = params.has('tall') ? 1600 : 600;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#b6d8ce';
  context.fillRect(0, 0, canvas.width, canvas.height);
  return [{ id: 'first', name: '截图.png', url: canvas.toDataURL() }];
}

function Harness() {
  const [images, setImages] = useState(initialImages);
  return <div style={{ padding: 32 }}>
    <ImageAttachments images={images} disabled={false}
      onRemove={(id) => setImages((values) => values.filter((image) => image.id !== id))}
      onEdit={(id, url) => setImages((values) => values.map((image) => image.id === id ? { ...image, url } : image))} />
    <textarea aria-label="消息" defaultValue="请看图片中圈出的部分" />
  </div>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
