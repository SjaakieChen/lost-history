import { LandscapeViewer } from '../react/LandscapeViewer';

const BACKGROUND_URL = '/artAssets/landscape5.png';

export function App() {
    return (
        <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
            <h1 style={{ marginBottom: 8 }}>Landscape Display — React smoke test</h1>
            <p style={{ marginBottom: 16, color: '#444' }}>
                Example voxel object placed by default. Horizon auto-detected from the
                background image. Parallax + shadows.
            </p>
            <LandscapeViewer
                backgroundUrl={BACKGROUND_URL}
                onHorizonDetected={(ratio) =>
                    console.log(`Detected horizon ratio: ${ratio.toFixed(3)}`)
                }
            />
        </div>
    );
}
