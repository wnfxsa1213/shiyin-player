import { useLocation } from 'react-router-dom';
import { useSceneStore } from '@/store/sceneStore';
import { useUiStore } from '@/store/uiStore';
import SceneSurface from './SceneSurface';

export default function SceneBackground() {
  const scene = useSceneStore(state => state.current);
  const immersive = useUiStore(state => state.immersiveOpen);
  const location = useLocation();
  return <SceneSurface scene={scene} variant="main" active={!immersive && location.pathname !== '/scenes'} />;
}
