class VideoConverter {
    constructor() {
        this.audioFile = null;
        this.imageFile = null;
        this.processingJobs = new Set(); // Track processing jobs
        this.init();
    }

    init() {
        this.initializeElements();
        this.setupEventListeners();
        this.loadExistingJobs();
        this.setupBeforeUnloadWarning();
    }

    initializeElements() {
        this.audioDropZone = document.getElementById('audioDropZone');
        this.imageDropZone = document.getElementById('imageDropZone');
        this.audioInput = document.getElementById('audioInput');
        this.imageInput = document.getElementById('imageInput');
        this.generateBtn = document.getElementById('generateBtn');
        this.jobList = document.getElementById('jobList');
        this.audioFileName = document.getElementById('audioFileName');
        this.imageFileName = document.getElementById('imageFileName');
    }

    setupEventListeners() {
        // Setup drag and drop for audio
        this.setupDropZone(this.audioDropZone, this.audioInput, 'audio');
        
        // Setup drag and drop for image
        this.setupDropZone(this.imageDropZone, this.imageInput, 'image');

        // Setup button clicks for file selection
        this.audioDropZone.querySelector('.upload-btn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.audioInput.click();
        });

        this.imageDropZone.querySelector('.upload-btn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.imageInput.click();
        });

        // Generate button click
        this.generateBtn.addEventListener('click', () => this.generateVideo());
    }

    setupDropZone(dropZone, input, type) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        dropZone.addEventListener('dragenter', () => {
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragover', () => {
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', (e) => {
            dropZone.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            this.handleFileSelect(file, type);
        });

        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            this.handleFileSelect(file, type);
        });
    }

    handleFileSelect(file, type) {
        if (type === 'audio' && file.type === 'audio/mpeg') {
            this.audioFile = file;
            this.audioDropZone.classList.add('has-file');
            this.audioFileName.textContent = file.name;
        } else if (type === 'image' && file.type.startsWith('image/')) {
            this.imageFile = file;
            this.imageDropZone.classList.add('has-file');
            this.imageFileName.textContent = file.name;
        }

        this.generateBtn.disabled = !(this.audioFile && this.imageFile);
    }

    async generateVideo() {
        const formData = new FormData();
        formData.append('audio', this.audioFile);
        formData.append('image', this.imageFile);

        try {
            const response = await fetch('/api/convert', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            this.addJobToList(data.jobId, data.status, data.title, data.previewUrl, data.outputFileName);
            this.resetUploadForm();
            this.startPolling(data.jobId);
        } catch (error) {
            console.error('Error generating video:', error);
            alert('Error generating video. Please try again.');
        }
    }

    resetUploadForm() {
        this.audioFile = null;
        this.imageFile = null;
        this.audioDropZone.classList.remove('has-file');
        this.imageDropZone.classList.remove('has-file');
        this.audioFileName.textContent = '';
        this.imageFileName.textContent = '';
        this.generateBtn.disabled = true;
        this.audioInput.value = '';
        this.imageInput.value = '';
    }

    addJobToList(jobId, status, title, previewUrl, outputFileName) {
        if (status === 'progress') {
            this.processingJobs.add(jobId);
        }
        
        const jobElement = document.createElement('div');
        jobElement.className = 'job-item';
        jobElement.id = `job-${jobId}`;
        
        // Store job data in localStorage
        const jobData = {
            id: jobId,
            status,
            title,
            previewUrl,
            outputFileName,
            timestamp: new Date().toISOString()
        };
        this.saveJobToStorage(jobData);
        
        jobElement.innerHTML = `
            <div class="job-info">
                <div class="preview-container">
                    <img src="${previewUrl}" alt="Video Preview" onerror="this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='">
                </div>
                <div class="job-details">
                    <span class="job-title">${title || 'Untitled'}</span>
                    <div class="status-container">
                        <span class="job-status status-${status}">${status === 'progress' ? 'Generating...' : status}</span>
                        ${status === 'finished' ? 
                            `<button class="download-btn" data-filename="${outputFileName}">
                                Download
                            </button>` : 
                            ''}
                    </div>
                </div>
            </div>
        `;
        
        // Add click handler for download button
        const downloadBtn = jobElement.querySelector('.download-btn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                const filename = downloadBtn.dataset.filename;
                window.location.href = `/download/${encodeURIComponent(filename)}`;
            });
        }
        
        this.jobList.prepend(jobElement);
    }

    // Add these new methods for persistent storage
    saveJobToStorage(jobData) {
        const jobs = this.getJobsFromStorage();
        jobs[jobData.id] = jobData;
        localStorage.setItem('videoJobs', JSON.stringify(jobs));
    }

    getJobsFromStorage() {
        const jobs = localStorage.getItem('videoJobs');
        return jobs ? JSON.parse(jobs) : {};
    }

    updateJobStatus(jobId, status) {
        const jobs = this.getJobsFromStorage();
        if (jobs[jobId]) {
            jobs[jobId].status = status;
            localStorage.setItem('videoJobs', JSON.stringify(jobs));
        }
    }

    async loadExistingJobs() {
        try {
            // Clear existing jobs in the UI
            this.jobList.innerHTML = '';
            
            // Load jobs from localStorage
            const savedJobs = this.getJobsFromStorage();
            
            // Get fresh status from server
            const response = await fetch('/api/jobs');
            const serverJobs = await response.json();
            
            // Create a map of server jobs for easy lookup
            const serverJobsMap = new Map(serverJobs.map(job => [job._id, job]));
            
            // Sort jobs by timestamp, newest first
            const sortedJobs = Object.values(savedJobs).sort((a, b) => 
                new Date(b.timestamp) - new Date(a.timestamp)
            );

            for (const job of sortedJobs) {
                const serverJob = serverJobsMap.get(job.id);
                const currentStatus = serverJob ? serverJob.status : job.status;
                
                this.addJobToList(job.id, currentStatus, job.title, job.previewUrl, job.outputFileName);
                
                if (currentStatus === 'progress') {
                    this.startPolling(job.id);
                }
            }
        } catch (error) {
            console.error('Error loading existing jobs:', error);
        }
    }

    setupBeforeUnloadWarning() {
        window.addEventListener('beforeunload', (e) => {
            if (this.processingJobs.size > 0) {
                // Show warning if there are videos being processed
                const message = 'Videos are still being processed. Are you sure you want to leave?';
                e.returnValue = message;
                return message;
            }
        });
    }

    startPolling(jobId) {
        const pollInterval = setInterval(async () => {
            try {
                const response = await fetch(`/api/jobs/${jobId}`);
                const job = await response.json();
                
                const jobElement = document.getElementById(`job-${jobId}`);
                if (jobElement) {
                    const statusContainer = jobElement.querySelector('.status-container');
                    const statusSpan = statusContainer.querySelector('.job-status');
                    statusSpan.className = `job-status status-${job.status}`;
                    statusSpan.textContent = job.status === 'progress' ? 'Generating...' : job.status;

                    // Add download button when finished
                    if (job.status === 'finished' && !statusContainer.querySelector('.download-btn')) {
                        const downloadBtn = document.createElement('button');
                        downloadBtn.className = 'download-btn';
                        downloadBtn.textContent = 'Download';
                        downloadBtn.dataset.filename = job.outputFileName;
                        downloadBtn.addEventListener('click', () => {
                            window.location.href = `/download/${encodeURIComponent(job.outputFileName)}`;
                        });
                        statusContainer.appendChild(downloadBtn);
                    }
                }

                if (job.status === 'finished' || job.status === 'error') {
                    clearInterval(pollInterval);
                    this.processingJobs.delete(jobId);
                    this.updateJobStatus(jobId, job.status);
                }
            } catch (error) {
                console.error('Error polling job status:', error);
                clearInterval(pollInterval);
                this.processingJobs.delete(jobId);
            }
        }, 2000);
    }
}

// Initialize the converter when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new VideoConverter();
});