/**
 * public/js/bg-effects.js
 * Handle Canvas Particles & other visual effects
 */

document.addEventListener('DOMContentLoaded', () => {
    initParticles();
});

function initParticles() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let width, height;
    let particles = [];

    // Configuration
    const particleCount = 60; // Adjust for density
    const connectionDistance = 150;
    const moveSpeed = 0.5;

    // Resize
    function resize() {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
    }
    window.addEventListener('resize', resize);
    resize();

    // Particle Class
    class Particle {
        constructor() {
            this.x = Math.random() * width;
            this.y = Math.random() * height;
            this.vx = (Math.random() - 0.5) * 0.5; // Slight drift
            this.vy = Math.random() * moveSpeed + 0.2; // Falling down
            this.size = Math.random() * 2 + 1;
        }

        update() {
            this.x += this.vx;
            this.y += this.vy;

            // Reset if out of bounds
            if (this.y > height) {
                this.y = -10;
                this.x = Math.random() * width;
            }
            if (this.x > width || this.x < 0) {
                this.vx *= -1;
            }
        }

        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(128, 128, 128, 0.5)'; // Gray particles
            ctx.fill();
        }
    }

    // Init Particles
    for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle());
    }

    // Animation Loop
    function animate() {
        ctx.clearRect(0, 0, width, height);

        // Update & Draw Particles
        particles.forEach(p => {
            p.update();
            p.draw();
        });

        // Draw Connections
        connectParticles();

        requestAnimationFrame(animate);
    }

    function connectParticles() {
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < connectionDistance) {
                    const opacity = 1 - (dist / connectionDistance);
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(128, 128, 128, ${opacity * 0.5})`; // Gray lines
                    ctx.lineWidth = 1;
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.stroke();
                }
            }
        }
    }

    animate();
}
