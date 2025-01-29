const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const ffmpeg = require('fluent-ffmpeg');
const VideoJob = require('../models/videoJob');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        // Keep the original file name but add timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        cb(null, `${path.parse(file.originalname).name}-${timestamp}${path.extname(file.originalname)}`);
    }
});

const upload = multer({ storage });

// Ensure uploads directory exists
const ensureUploadsDir = async () => {
    const dirs = ['uploads', 'output'];
    for (const dir of dirs) {
        try {
            await fs.access(dir);
        } catch {
            await fs.mkdir(dir);
        }
    }
};

ensureUploadsDir();

// Get all jobs
router.get('/jobs', async (req, res) => {
    try {
        const jobs = await VideoJob.find().sort({ createdAt: -1 });
        res.json(jobs);
    } catch (error) {
        console.error('Error fetching jobs:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single job status
router.get('/jobs/:id', async (req, res) => {
    try {
        const job = await VideoJob.findById(req.params.id);
        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }
        res.json(job);
    } catch (error) {
        console.error('Error fetching job:', error);
        res.status(500).json({ error: error.message });
    }
});

// Convert video
router.post('/convert', upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'image', maxCount: 1 }
]), async (req, res) => {
    console.log('Received conversion request');
    try {
        const audioFile = req.files['audio'][0];
        const imageFile = req.files['image'][0];
        
        // Get original MP3 name without extension
        const mp3Name = path.parse(audioFile.originalname).name;
        const timestamp = new Date().toISOString()
            .replace(/[:.]/g, '-')
            .replace('T', '_')
            .slice(0, -5); // Remove milliseconds
        
        const outputFileName = `${mp3Name}_${timestamp}.mp4`;
        
        console.log('Creating job with name:', outputFileName);

        // Create new job in database
        const job = new VideoJob({
            audioFileName: audioFile.filename,
            imageFileName: imageFile.filename,
            outputFileName: outputFileName,
            title: mp3Name
        });
        await job.save();

        // Ensure previews directory exists
        const previewsDir = path.join(__dirname, '..', '..', 'public', 'previews');
        await fs.mkdir(previewsDir, { recursive: true });

        // Copy and rename image for preview
        const previewFileName = `preview-${job._id}${path.extname(imageFile.originalname)}`;
        const previewPath = path.join(previewsDir, previewFileName);
        
        await fs.copyFile(
            path.join('uploads', imageFile.filename),
            previewPath
        );

        console.log('Preview created at:', previewPath);

        res.json({ 
            jobId: job._id,
            status: 'progress',
            title: mp3Name,
            previewUrl: `/previews/${previewFileName}`
        });

        // Start conversion process
        processVideo(job).catch(err => {
            console.error('Error in processVideo:', err);
        });
    } catch (error) {
        console.error('Error in convert endpoint:', error);
        res.status(500).json({ error: error.message });
    }
});

async function processVideo(job) {
    console.log('Starting video processing for job:', job._id);
    const outputPath = path.join('output', job.outputFileName);
    
    try {
        console.log('Getting audio duration...');
        const duration = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(path.join('uploads', job.audioFileName), (err, metadata) => {
                if (err) {
                    console.error('FFprobe error:', err);
                    reject(err);
                    return;
                }
                console.log('Audio duration:', metadata.format.duration);
                resolve(metadata.format.duration);
            });
        });

        console.log('Starting FFmpeg process...');
        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(path.join('uploads', job.audioFileName))
                .input(path.join('uploads', job.imageFileName))
                .outputOptions([
                    // Video settings
                    '-c:v libx264',           // H.264 codec
                    '-r 24',                  // 24 fps
                    '-b:v 8M',               // 8Mbps video bitrate
                    '-maxrate 8M',           // Maximum bitrate
                    '-bufsize 16M',          // Buffer size (2x bitrate)
                    '-pix_fmt yuv420p',      // Pixel format for compatibility
                    
                    // Audio settings
                    '-c:a aac',              // AAC-LC codec
                    '-ac 2',                 // Stereo audio (2 channels)
                    '-ar 48000',             // 48kHz sample rate
                    '-b:a 384k',             // 384kbps audio bitrate
                    
                    // General settings
                    '-movflags +faststart',  // Web playback optimization
                    '-t', duration.toString(),
                    '-y'                     // Overwrite output file
                ])
                .videoFilters([
                    {
                        filter: 'scale',
                        options: '1920:1080:force_original_aspect_ratio=decrease'
                    },
                    {
                        filter: 'pad',
                        options: '1920:1080:(ow-iw)/2:(oh-ih)/2'
                    }
                ])
                .size('1920x1080')
                .output(outputPath)
                .on('start', (commandLine) => {
                    console.log('FFmpeg command:', commandLine);
                })
                .on('progress', (progress) => {
                    console.log('Processing: ' + progress.percent + '% done');
                })
                .on('end', () => {
                    console.log('FFmpeg process finished');
                    resolve();
                })
                .on('error', (err) => {
                    console.error('FFmpeg error:', err);
                    reject(err);
                })
                .run();
        });

        console.log('Video processing completed');
        // Update job status to finished
        job.status = 'finished';
        await job.save();

        // Clean up upload files
        await fs.unlink(path.join('uploads', job.audioFileName));
        await fs.unlink(path.join('uploads', job.imageFileName));
        console.log('Cleanup completed');

    } catch (error) {
        console.error('Error processing video:', error);
        job.status = 'error';
        await job.save();
    }
}

// Helper function to get audio duration
function getDuration(audioPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(audioPath, (err, metadata) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(metadata.format.duration);
        });
    });
}

module.exports = router;
