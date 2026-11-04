import { createRoot } from 'react-dom/client';
import { MessageImage } from '../../../shared/conversation/MessageImage';
import { FileEnvironmentContext, type FileEnvironment } from '../../../shared/conversation/fileEnvironment';
import { ChatImage } from '../../../shared/remote-chat/views/ChatImage';
import { ImageAiContext } from '../../../shared/chat/ImageAiContext';
import '../src/styles.css';
import '../../../shared/remote-chat/views/messages.css';

const params = new URLSearchParams(location.search);
const canvas = document.createElement('canvas');
canvas.width = params.has('large') ? 7680 : 1800;
canvas.height = params.has('large') ? 4320 : 1000;
const context = canvas.getContext('2d')!;
context.fillStyle = '#143f4b';
context.fillRect(0, 0, canvas.width, canvas.height);
context.strokeStyle = '#7cc9d1';
context.lineWidth = 4;
for (let x = 0; x < canvas.width; x += 100) context.strokeRect(x, 0, 100, canvas.height);
context.fillStyle = '#ffcd77';
context.fillRect(650, 350, 500, 300);
const source = canvas.toDataURL();
const mode = params.get('mode');
const unavailable = async (): Promise<never> => { throw new Error('Unexpected file operation'); };
const environment: FileEnvironment = {
  remote: true, actions: { applications: unavailable, perform: unavailable },
  previews: { open: unavailable, close: unavailable }, resolveWebsite: unavailable,
  image: props => <ChatImage source={props.src} description={props.alt} />,
};

function Harness() {
  const preview = mode === 'web' ? <ChatImage source={source} description="拖动测试" />
    : <MessageImage src={source} alt="拖动测试" />;
  return <main data-testid="conversation" data-wheel-events="0"
    style={{ padding: 32, height: '100vh', overflow: 'auto' }}
    onWheel={event => {
      event.currentTarget.dataset.wheelEvents = String(Number(event.currentTarget.dataset.wheelEvents) + 1);
    }}>
    <FileEnvironmentContext.Provider value={mode === 'remote' ? environment : null}>
      <ImageAiContext.Provider value={params.has('no-editor') ? null : { enabled: true, send: async () => true }}>
        {params.has('linked') ? <a href="#image" onClick={event => event.preventDefault()}>{preview}</a> : preview}
      </ImageAiContext.Provider>
    </FileEnvironmentContext.Provider>
    <div style={{ height: 2000 }} />
  </main>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
