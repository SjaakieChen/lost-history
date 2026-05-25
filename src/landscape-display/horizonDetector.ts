/**
 * Horizon Detection Utility
 * 
 * Detects the horizon line in an image by analyzing vertical color gradients.
 * The horizon is identified as the row where color changes are most pronounced.
 */

/**
 * Detects the horizon ratio in an image by analyzing vertical color gradients.
 * 
 * @param imageUrl The URL of the image to analyze
 * @returns A Promise that resolves to the horizon ratio (0.0 = bottom, 1.0 = top)
 *          Clamped between 0.1 and 0.5 for reasonable values.
 *          Returns 0.25 (default) if detection fails.
 */
export async function detectHorizonRatio(imageUrl: string): Promise<number> {
    const DEFAULT_RATIO = 0.25;
    
    try {
        // 1. Load the image
        const img = new Image();
        img.crossOrigin = 'anonymous'; // Handle CORS if needed
        
        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                if (img.width === 0 || img.height === 0) {
                    reject(new Error('Image has zero dimensions'));
                    return;
                }
                resolve();
            };

            img.onload = finish;
            img.onerror = () => {
                if (settled) return;
                settled = true;
                reject(new Error('Failed to load image'));
            };

            img.src = imageUrl;

            if (img.complete && img.width > 0 && img.height > 0) {
                finish();
            }
        });
        
        // 2. Create canvas and draw image
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
            console.warn('Failed to get canvas context, using default horizon ratio');
            return DEFAULT_RATIO;
        }
        
        ctx.drawImage(img, 0, 0);
        
        // 3. Get pixel data
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const width = canvas.width;
        const height = canvas.height;
        
        // 4. Calculate gradient for each row
        let maxGradient = 0;
        let horizonRow = Math.floor(height * 0.75); // Default to 25% from bottom (75% from top)
        
        // Process each row (except the last one, since we compare with next row)
        for (let y = 0; y < height - 1; y++) {
            let rowGradient = 0;
            
            // Sum RGB differences between this row and the next row
            for (let x = 0; x < width; x++) {
                const idx1 = (y * width + x) * 4;      // pixel at (x, y)
                const idx2 = ((y + 1) * width + x) * 4; // pixel at (x, y + 1)
                
                const r1 = data[idx1];
                const g1 = data[idx1 + 1];
                const b1 = data[idx1 + 2];
                const r2 = data[idx2];
                const g2 = data[idx2 + 1];
                const b2 = data[idx2 + 2];
                
                // Calculate Manhattan distance (sum of absolute differences)
                const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
                rowGradient += diff;
            }
            
            // Track the row with maximum gradient
            if (rowGradient > maxGradient) {
                maxGradient = rowGradient;
                horizonRow = y;
            }
        }
        
        // 5. Convert horizon row to ratio
        // horizonRatio: 0.0 = bottom, 1.0 = top
        // horizonRow: 0 = top, height-1 = bottom
        // So: ratio = (height - horizonRow) / height
        let ratio = (height - horizonRow) / height;
        
        // 6. Clamp between 0.1 and 0.5 for reasonable values
        ratio = Math.max(0.1, Math.min(0.5, ratio));
        
        return ratio;
        
    } catch (error) {
        console.warn('Horizon detection failed:', error, 'Using default ratio');
        return DEFAULT_RATIO;
    }
}