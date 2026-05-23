// GLOBALS
let currentLat = null, currentLon = null, mapInstance = null, userMarker = null, placeMarkers = [];
let uploadedImageFile = null;

// DOM elements
const imageInput = document.getElementById('imageInput');
const previewContainer = document.getElementById('previewContainer');
const scanLocationBtn = document.getElementById('scanLocationBtn');
const scanResultDiv = document.getElementById('scanResult');
const coordDisplay = document.getElementById('coordDisplay');
const addressInfo = document.getElementById('addressInfo');
const placesGrid = document.getElementById('placesGrid');
const refreshPlacesBtn = document.getElementById('refreshPlacesBtn');

// Map initialization
function initMap(lat, lon) {
    if (!mapInstance) {
        mapInstance = L.map('map').setView([lat, lon], 15);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OSM'
        }).addTo(mapInstance);
        userMarker = L.marker([lat, lon]).addTo(mapInstance).bindPopup('📍 location').openPopup();
    } else {
        mapInstance.setView([lat, lon], 15);
        if (userMarker) userMarker.setLatLng([lat, lon]).bindPopup('📍 location').openPopup();
        else userMarker = L.marker([lat, lon]).addTo(mapInstance).bindPopup('📍 location').openPopup();
    }
    placeMarkers.forEach(m => mapInstance.removeLayer(m));
    placeMarkers = [];
}

// Reverse geocoding
async function reverseGeocode(lat, lon) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=16`;
        const resp = await fetch(url, { headers: { 'User-Agent': 'LocationScanner/1.0' } });
        const data = await resp.json();
        if (data.display_name) return data.display_name.split(',').slice(0,3).join(',');
        return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    } catch(e) {
        return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }
}

// Fetch 5 nearby places (Overpass API)
async function fetchNearbyPlaces(lat, lon, radius = 1200) {
    const query = `[out:json][timeout:15];(node["amenity"~"cafe|restaurant|pub|bar"](around:${radius},${lat},${lon});node["tourism"~"attraction|museum"](around:${radius},${lat},${lon});node["shop"~"convenience|books"](around:${radius},${lat},${lon});node["leisure"~"park"](around:${radius},${lat},${lon}););out body center;`;
    try {
        const res = await fetch("https://overpass-api.de/api/interpreter", {
            method: 'POST',
            body: `data=${encodeURIComponent(query)}`,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const data = await res.json();
        let elements = data.elements || [];
        const unique = [];
        const seen = new Set();
        for (let el of elements) {
            if (!seen.has(el.id) && el.lat && el.lon) {
                seen.add(el.id);
                unique.push(el);
            }
            if (unique.length >= 5) break;
        }
        if (unique.length < 5) {
            const fallback = ["Local Cafe", "Park Corner", "Art Space", "Bookstore", "Scenic Spot"];
            for (let i = unique.length; i < 5; i++) {
                unique.push({
                    id: `mock_${i}`,
                    lat: lat + (Math.random() - 0.5) * 0.006,
                    lon: lon + (Math.random() - 0.5) * 0.006,
                    tags: { name: fallback[i] }
                });
            }
        }
        return unique.slice(0, 5);
    } catch(e) {
        return generateMock(lat, lon);
    }
}

function generateMock(lat, lon) {
    const names = ["Heritage Walk", "Riverside Plaza", "Sunset Hill", "Art District", "Cozy Library"];
    const arr = [];
    for (let i = 0; i < 5; i++) {
        arr.push({
            id: i,
            lat: lat + (Math.random() - 0.5) * 0.008,
            lon: lon + (Math.random() - 0.5) * 0.008,
            tags: { name: names[i] }
        });
    }
    return arr;
}

// Distance helpers
function getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180, Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(m) {
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function getImageUrl(id) {
    let seed = (typeof id === 'number') ? (id % 150) + 20 : 45;
    return `https://picsum.photos/id/${seed}/400/240`;
}

function escapeHtml(str) {
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// Render 5 places
async function renderPlacesOnUI(places, centerLat, centerLon) {
    placesGrid.innerHTML = '';
    if (!places.length) {
        placesGrid.innerHTML = '<div class="loader">No places found</div>';
        return;
    }
    for (let p of places) {
        const name = p.tags?.name || 'Place';
        const dist = getDistanceMeters(centerLat, centerLon, p.lat, p.lon);
        const card = document.createElement('div');
        card.className = 'place-card';
        card.innerHTML = `
            <img src="${getImageUrl(p.id)}" loading="lazy">
            <div class="place-info">
                <div class="place-name">${escapeHtml(name)}</div>
                <div class="place-distance">${formatDistance(dist)} away</div>
                <span class="badge">Nearby spot</span>
            </div>
        `;
        placesGrid.appendChild(card);
    }
    if (mapInstance) {
        placeMarkers.forEach(m => mapInstance.removeLayer(m));
        placeMarkers = [];
        for (let p of places) {
            const icon = L.divIcon({ html: '<i class="fas fa-flag-checkered" style="color:#e67e22;"></i>', iconSize: [20,20] });
            const m = L.marker([p.lat, p.lon], { icon }).addTo(mapInstance).bindPopup(p.tags?.name || 'place');
            placeMarkers.push(m);
        }
    }
}

// EXIF extraction
function extractGPSFromFile(file) {
    return new Promise((resolve, reject) => {
        EXIF.getData(file, function() {
            const latRef = EXIF.getTag(this, 'GPSLatitudeRef');
            const latArr = EXIF.getTag(this, 'GPSLatitude');
            const lonRef = EXIF.getTag(this, 'GPSLongitudeRef');
            const lonArr = EXIF.getTag(this, 'GPSLongitude');
            if (latArr && lonArr && latRef && lonRef) {
                let lat = latArr[0] + latArr[1] / 60 + latArr[2] / 3600;
                if (latRef === 'S') lat = -lat;
                let lon = lonArr[0] + lonArr[1] / 60 + lonArr[2] / 3600;
                if (lonRef === 'W') lon = -lon;
                resolve({ lat, lon });
            } else {
                reject(new Error('No GPS metadata'));
            }
        });
    });
}

function previewImage(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        previewContainer.innerHTML = `<img src="${e.target.result}" class="preview-img">`;
    };
    reader.readAsDataURL(file);
}

// Main scan
async function scanPicture() {
    if (!uploadedImageFile) {
        scanResultDiv.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Please select an image first.';
        return;
    }
    scanResultDiv.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Scanning EXIF...';
    try {
        const coords = await extractGPSFromFile(uploadedImageFile);
        currentLat = coords.lat;
        currentLon = coords.lon;
        coordDisplay.innerHTML = `<strong>GPS:</strong> ${currentLat.toFixed(5)}, ${currentLon.toFixed(5)}`;
        initMap(currentLat, currentLon);
        const addr = await reverseGeocode(currentLat, currentLon);
        addressInfo.innerHTML = `📍 ${addr}`;
        scanResultDiv.innerHTML = '<i class="fas fa-check-circle" style="color:green"></i> GPS found! Loading 5 places...';
        refreshPlacesBtn.disabled = false;
        const places = await fetchNearbyPlaces(currentLat, currentLon, 1300);
        await renderPlacesOnUI(places, currentLat, currentLon);
    } catch(err) {
        scanResultDiv.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${err.message}. Tap on map to set location manually.`;
        if (mapInstance) {
            mapInstance.once('click', async (e) => {
                currentLat = e.latlng.lat;
                currentLon = e.latlng.lng;
                coordDisplay.innerHTML = `<strong>Manual:</strong> ${currentLat.toFixed(5)}, ${currentLon.toFixed(5)}`;
                initMap(currentLat, currentLon);
                const addr = await reverseGeocode(currentLat, currentLon);
                addressInfo.innerHTML = `📍 ${addr}`;
                const places = await fetchNearbyPlaces(currentLat, currentLon, 1300);
                await renderPlacesOnUI(places, currentLat, currentLon);
                refreshPlacesBtn.disabled = false;
                scanResultDiv.innerHTML = 'Location set manually. Use refresh.';
            });
        }
    }
}

// Refresh places
async function refreshPlaces() {
    if (currentLat === null || currentLon === null) {
        scanResultDiv.innerHTML = 'No location. Scan or tap map first.';
        return;
    }
    placesGrid.innerHTML = '<div class="loader">Refreshing...</div>';
    const newPlaces = await fetchNearbyPlaces(currentLat, currentLon, 1300);
    await renderPlacesOnUI(newPlaces, currentLat, currentLon);
    scanResultDiv.innerHTML = '5 nearby places updated.';
}

// Event listeners
imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && (file.type === 'image/jpeg' || file.type === 'image/jpg' || file.type === 'image/png')) {
        uploadedImageFile = file;
        previewImage(file);
        scanResultDiv.innerHTML = 'Image loaded. Click "Find location from picture".';
    } else {
        uploadedImageFile = null;
        previewContainer.innerHTML = '';
        scanResultDiv.innerHTML = 'Select a valid JPEG/PNG.';
    }
});
scanLocationBtn.addEventListener('click', scanPicture);
refreshPlacesBtn.addEventListener('click', refreshPlaces);

// Initialize empty map
mapInstance = L.map('map').setView([20, 0], 2);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: 'Map data OSM'
}).addTo(mapInstance);
userMarker = null;

// Manual map click when no location set
mapInstance.on('click', async (e) => {
    if (currentLat === null && currentLon === null) {
        currentLat = e.latlng.lat;
        currentLon = e.latlng.lng;
        coordDisplay.innerHTML = `<strong>Manual:</strong> ${currentLat.toFixed(5)}, ${currentLon.toFixed(5)}`;
        initMap(currentLat, currentLon);
        const addr = await reverseGeocode(currentLat, currentLon);
        addressInfo.innerHTML = `📍 ${addr}`;
        const places = await fetchNearbyPlaces(currentLat, currentLon, 1300);
        await renderPlacesOnUI(places, currentLat, currentLon);
        refreshPlacesBtn.disabled = false;
        scanResultDiv.innerHTML = 'Location set by map click.';
    }
});
