const mongoose = require('mongoose');

const videoJobSchema = new mongoose.Schema({
    status: {
        type: String,
        enum: ['progress', 'finished', 'error'],
        default: 'progress'
    },
    audioFileName: String,
    imageFileName: String,
    outputFileName: String,
    originalImageName: String,
    title: String,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('VideoJob', videoJobSchema);
