// Mobile menu toggle
function toggleMenu() {
    const navMenu = document.querySelector('.nav-menu');
    navMenu.classList.toggle('active');
}

// Close mobile menu when clicking on a link
document.querySelectorAll('.nav-menu a').forEach(link => {
    link.addEventListener('click', () => {
        const navMenu = document.querySelector('.nav-menu');
        if (navMenu.classList.contains('active')) {
            navMenu.classList.remove('active');
        }
    });
});

// App filtering functionality
function filterApps(filter) {
    const apps = document.querySelectorAll('.app-card');
    const tabs = document.querySelectorAll('.tab-btn');
    
    // Update active tab
    tabs.forEach(tab => tab.classList.remove('active'));
    event.target.classList.add('active');
    
    // Filter apps
    apps.forEach(app => {
        const status = app.getAttribute('data-status');
        
        if (filter === 'all') {
            app.style.display = 'flex';
        } else if (filter === 'live' && status === 'live') {
            app.style.display = 'flex';
        } else if (filter === 'soon' && status === 'soon') {
            app.style.display = 'flex';
        } else {
            app.style.display = 'none';
        }
    });
}

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth'
            });
        }
    });
});

// Add active class to current page in navigation
document.addEventListener('DOMContentLoaded', () => {
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-menu a').forEach(link => {
        const href = link.getAttribute('href');
        if (href === currentPage || (currentPage === '' && href === 'index.html')) {
            link.classList.add('active');
        }
    });
});
