import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Keyboard } from 'react-native';
import { ImageViewer } from './ImageViewer';

interface ImagePreview {
  key: string; thumbnail: string; description: string; load: () => Promise<string>;
  save?: (url: string) => Promise<void>;
}
const ImagePreviewContext = createContext<((image: ImagePreview) => void) | null>(null);

/** Keep the modal outside virtualized messages so rotation cannot unmount the active image. */
export function ChatImagePreviewProvider({ children }: { children: ReactNode }) {
  const [image, setImage] = useState<ImagePreview | null>(null);
  const open = useCallback((preview: ImagePreview) => { Keyboard.dismiss(); setImage(preview); }, []);
  return <ImagePreviewContext.Provider value={open}>
    {children}
    {image && <ImageViewer key={image.key} thumbnail={image.thumbnail} description={image.description}
      load={image.load} save={image.save} close={() => setImage(null)} />}
  </ImagePreviewContext.Provider>;
}

export function useChatImagePreview() {
  const open = useContext(ImagePreviewContext);
  if (!open) throw new Error('Chat images require ChatImagePreviewProvider');
  return open;
}
