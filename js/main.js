import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { getFirestore, doc, addDoc, setDoc, deleteDoc, onSnapshot, collection, query, serverTimestamp, setLogLevel, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global Firebase and Application Setup ---
// Setting Firebase log level for debugging
setLogLevel('Debug');

const appId = typeof __app_id !== 'undefined' ? __app_id : 'codebykavin'; // Align with projectId for consistency
const firebaseConfig = {
  apiKey: "%%FIREBASE_API_KEY%%",
  authDomain: "%%FIREBASE_AUTH_DOMAIN%%",
  projectId: "%%FIREBASE_PROJECT_ID%%",
  storageBucket: "%%FIREBASE_STORAGE_BUCKET%%",
  messagingSenderId: "%%FIREBASE_MESSAGING_SENDER_ID%%",
  appId: "%%FIREBASE_APP_ID%%"
};



let app, db, auth, storage;
let isAuthReady = false;
let isAuthenticatedAdmin = false; // Flag for UI control
let isSigningUp = false; // Auth screen state
let currentAppId = null; // Used for changelog tracking

// Global state to hold app data, avoiding injection into HTML
let appsState = new Map();

// Firestore Paths (Simplified for cleaner code)
// NOTE: The /artifacts/{appId}/public/data prefix is mandatory for the environment's security model.
let PUBLIC_BASE, AppsCollection, DeveloperProfileDoc;

// --- Utility Functions ---

// Curated list of useful Lucide icons for the dropdown
const lucideIconOptions = [
    'rocket', 'gamepad-2', 'check-circle', 'wrench', 'flask-conical', 'layout-grid', 'package', 'star',
    'calendar-check', 'droplets', 'terminal', 'code', 'book', 'camera', 'cloud', 'database', 'file-text',
    'folder', 'globe', 'heart', 'image', 'mail', 'message-square', 'music', 'pen-tool', 'shield', 'shopping-cart', 'video', 'bug', 'cpu', 'fingerprint', 'lightbulb', 'map', 'monitor', 'mouse', 'network', 'pie-chart', 'plug', 'power', 'printer', 'qr-code', 'rss', 'server', 'settings', 'share-2', 'shield-check', 'smartphone', 'speaker', 'square', 'tablet', 'tag', 'target', 'thermometer', 'thumbs-up', 'toggle-left', 'tool', 'trending-up', 'tv', 'type', 'umbrella', 'upload', 'user', 'users', 'verified', 'volume-2', 'wallet', 'wifi', 'zap'
];

const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'N/A';
    if (timestamp.toDate) {
        return timestamp.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }
    return new Date(timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

const alertMessage = (message, type = 'info') => {
    const container = document.getElementById('message-container');
    const color = type === 'error' ? 'bg-red-600' : (type === 'success' ? 'bg-green-600' : 'bg-blue-600');

    const messageBox = document.createElement('div');
    messageBox.className = `${color} text-white p-3 mb-2 rounded-lg shadow-md flex items-center justify-between font-medium transition duration-300 cms-card`;
    messageBox.innerHTML = `<span>${message}</span>
                                    <button onclick="this.parentElement.remove()" class="ml-4 text-white opacity-70 hover:opacity-100">&times;</button>`;
    container.prepend(messageBox);

    setTimeout(() => {
        messageBox.remove();
    }, 5000);
};
window.alertMessage = alertMessage;

// Safety check for Lucide icons
const safeCreateIcons = () => {
    if (typeof window.lucide !== 'undefined' && window.lucide.createIcons) {
        window.lucide.createIcons();
    }
};

// --- Confirmation Modal Logic ---
const openConfirmationModal = (text, nameToConfirm, onConfirm) => {
    const modal = document.getElementById('confirm-modal');
    const textElement = document.getElementById('confirm-modal-text');
    const nameElement = document.getElementById('confirm-modal-name');
    const inputElement = document.getElementById('confirm-modal-input');
    const confirmBtn = document.getElementById('confirm-modal-confirm');
    const cancelBtn = document.getElementById('confirm-modal-cancel');

    textElement.textContent = text;
    nameElement.textContent = nameToConfirm;
    inputElement.value = '';
    confirmBtn.disabled = true;
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    const close = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        inputElement.oninput = null;
        confirmBtn.onclick = null;
        cancelBtn.onclick = null;
    };

    inputElement.oninput = () => { confirmBtn.disabled = inputElement.value !== nameToConfirm; };
    confirmBtn.onclick = () => { onConfirm(); close(); };
    cancelBtn.onclick = close;
};

// --- Authentication Logic ---

const updateAuthUI = (loggedIn) => {
    isAuthenticatedAdmin = loggedIn;
    
    // Note: The loading state should already be hidden by the onAuthStateChanged listener
    document.getElementById('auth-screen').classList.toggle('hidden', loggedIn);
    document.getElementById('auth-screen').classList.toggle('flex', !loggedIn);
    document.getElementById('app-container').classList.toggle('hidden', !loggedIn);
    document.getElementById('app-container').classList.toggle('flex', loggedIn);
    
    if (loggedIn) {
        // Ensure the default tab listener is running when the admin logs in
        switchTab('apps');
    } else {
        // Stop listeners when logged out
        if (unsubscribeChangelog) unsubscribeChangelog();
    }
};

const handleAuthToggle = () => {
    isSigningUp = !isSigningUp;
    const submitBtn = document.getElementById('auth-submit-btn');
    const toggleBtn = document.getElementById('auth-toggle-btn');
    
    if (isSigningUp) {
        submitBtn.textContent = 'Sign Up';
        toggleBtn.textContent = 'Already have an account? Click here to Sign In.';
    } else {
        submitBtn.textContent = 'Sign In';
        toggleBtn.textContent = 'Need an account? Click here to Sign Up.';
    }
};
window.handleAuthToggle = handleAuthToggle;

const handleAuthFormSubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    
    const submitBtn = document.getElementById('auth-submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = isSigningUp ? 'Signing Up...' : 'Signing In...';

    try {
        if (isSigningUp) {
            await createUserWithEmailAndPassword(auth, email, password);
            alertMessage("Sign up successful! You are now logged in.", 'success');
        } else {
            await signInWithEmailAndPassword(auth, email, password);
            alertMessage("Sign in successful!", 'success');
        }
    } catch (error) {
        console.error("Authentication Error:", error);
        // ERROR: auth/operation-not-allowed means Email/Password is not enabled in Firebase console
        alertMessage(`Auth Failed: ${error.message}. Please ensure Email/Password is enabled in your Firebase console.`, 'error'); 
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = isSigningUp ? 'Sign Up' : 'Sign In';
    }
};
document.getElementById('auth-form').addEventListener('submit', handleAuthFormSubmit);

const handleSignOut = async () => {
    try {
        await signOut(auth);
        alertMessage("Signed out successfully.", 'info');
        // The onAuthStateChanged listener handles the UI update
    } catch (error) {
        console.error("Sign out error:", error);
        alertMessage("Sign out failed.", 'error');
    }
};
window.handleSignOut = handleSignOut;

const initializeFirebase = async () => {
    try {
        // 1. Initialize Firebase
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        storage = getStorage(app);
        isAuthReady = true;

        // Define paths AFTER appId is guaranteed to be set
        PUBLIC_BASE = `/artifacts/${appId}/public/data`;
        AppsCollection = `${PUBLIC_BASE}/apps`;
        DeveloperProfileDoc = `${PUBLIC_BASE}/developerProfile/profile`;

        // 2. Set up the state listener to control UI
        onAuthStateChanged(auth, (user) => {
            document.getElementById('loading-state').classList.add('hidden');

            if (user && !user.isAnonymous) {
                // User is signed in with email/password (true admin)
                console.log("Admin Authenticated:", user.uid);
                updateAuthUI(true);
            } else {
                // User is NOT a valid Email/Password admin. Force login screen.
                if (user) {
                   console.log("Signed in anonymously. Displaying login screen for Admin access.");
                } else {
                   console.log("No user signed in. Displaying login screen.");
                }
                updateAuthUI(false);
            }
        });

    } catch (error) {
        console.error("Firebase Initialization Error:", error);
        document.getElementById('loading-state').innerHTML = `<p class="text-red-500 p-6">Firebase failed to initialize. Check console for details.</p>`;
    }
};

// Move renderRating to global scope as it's a utility
const renderRating = (rating) => {
    const fullStars = Math.floor(rating);
    const halfStar = rating % 1 !== 0;
    let stars = '';
    for (let i = 0; i < 5; i++) {
        if (i < fullStars) {
            stars += `<i data-lucide="star" class="w-4 h-4 text-yellow-400 fill-yellow-400"></i>`;
        } else if (i === fullStars && halfStar) {
            stars += `<i data-lucide="star-half" class="w-4 h-4 text-yellow-400 fill-yellow-400"></i>`;
        } else {
            stars += `<i data-lucide="star" class="w-4 h-4 text-gray-600"></i>`;
        }
    }
    return stars;
};

// --- Tab Switching Logic ---
const switchTab = (tabName) => {
    const tabs = ['apps', 'profile'];
    tabs.forEach(tab => {
        const button = document.getElementById(`tab-${tab}`);
        const section = document.getElementById(`${tab}-section`);
        const addAppButton = document.getElementById('add-app-button');

        if (tab === tabName) {
            button.classList.add('tab-active');
            section.classList.remove('hidden');
            if (tab === 'apps') {
                addAppButton.classList.remove('hidden');
                setupRealtimeListener(); 
            } else if (tab === 'profile') {
                addAppButton.classList.add('hidden');
                setupProfileListener(); 
                if (unsubscribeChangelog) unsubscribeChangelog(); 
            }
        } else {
            button.classList.remove('tab-active');
            section.classList.add('hidden');
        }
    });
};
window.switchTab = switchTab;


// --- Firestore Realtime Listener for Apps (APPS MANAGER) ---
const setupRealtimeListener = () => {
    if (!isAuthenticatedAdmin || !isAuthReady) return;
    // Use the simplified collection name
    const q = query(collection(db, AppsCollection));

    onSnapshot(q, (snapshot) => {
        // Instead of re-rendering everything, process individual changes
        snapshot.docChanges().forEach((change) => {
            const appData = { id: change.doc.id, ...change.doc.data() };
            if (change.type === "added") {
                appsState.set(appData.id, appData);
            }
            if (change.type === "modified") {
                appsState.set(appData.id, appData);
            }
            if (change.type === "removed") {
                appsState.delete(appData.id);
            }
        });

        // Convert map to array and render
        const appsArray = Array.from(appsState.values());
        renderApps(appsArray);

    }, (error) => {
        console.error("Error fetching documents: ", error);
        alertMessage("Error loading apps: " + error.message, 'error');
    });
};

// --- Changelog Listeners (SUBCOLLECTION MANAGER) ---
let unsubscribeChangelog = null;

const setupChangelogListener = (appId) => {
    if (unsubscribeChangelog) unsubscribeChangelog(); 

    if (!appId || !isAuthenticatedAdmin) return;
    
    // Construct changelog path using the simplified AppsCollection constant
    const CHANGELOG_PATH = `${AppsCollection}/${appId}/changelog`;
    const q = query(collection(db, CHANGELOG_PATH));

    unsubscribeChangelog = onSnapshot(q, (snapshot) => {
        const logs = [];
        snapshot.forEach((doc) => {
            logs.push({ id: doc.id, ...doc.data() });
        });
        renderChangelog(logs.sort((a, b) => (b.date && a.date ? b.date.toMillis() - a.date.toMillis() : 0))); // Sort by newest first
    }, (error) => {
        console.error("Error fetching changelog: ", error);
    });
};

const renderChangelog = (logs) => {
    const list = document.getElementById('changelog-list');
    list.innerHTML = '';
    
    if (logs.length === 0) {
        list.innerHTML = '<li class="text-gray-500 text-sm">No change history recorded.</li>';
        return;
    }

    logs.forEach(log => {
        const item = document.createElement('li');
        item.className = 'flex justify-between items-center text-sm border-b border-gray-700 pb-1';
        item.innerHTML = `
            <div class="flex flex-col">
                <span class="font-semibold text-gray-200">${log.version || 'v?'}: ${log.notes || 'No notes'}</span>
                <span class="text-xs text-gray-500">${formatTimestamp(log.date)}</span>
            </div>
            <button type="button" onclick="deleteChangelogEntry('${currentAppId}', '${log.id}', '${log.version}')" class="text-red-500 hover:text-red-400 transition ml-2">
                <i data-lucide="x" class="w-4 h-4"></i>
            </button>
        `;
        list.appendChild(item);
    });
    safeCreateIcons(); 
};
window.renderChangelog = renderChangelog; 

const addChangelogEntry = async () => {
    if (!currentAppId || !isAuthenticatedAdmin) return alertMessage("Access Denied: Must be signed in.", 'error');

    const version = document.getElementById('changelog-version').value.trim();
    const notes = document.getElementById('changelog-notes').value.trim();
    const dateValue = document.getElementById('changelog-date').value;

    if (!version || !notes) {
        return alertMessage("Please fill in both version and notes.", 'error');
    }

    const date = dateValue ? new Date(dateValue) : serverTimestamp();

    try {
        const CHANGELOG_PATH = `${AppsCollection}/${currentAppId}/changelog`;
        await addDoc(collection(db, CHANGELOG_PATH), {
            version: version,
            notes: notes,
            date: date
        });
        alertMessage(`Changelog for ${version} added!`, 'success');
        document.getElementById('changelog-version').value = '';
        document.getElementById('changelog-notes').value = '';

        // Denormalization: Update the parent app document with the latest version info.
        const appRef = doc(db, AppsCollection, currentAppId);
        await setDoc(appRef, { version: version, releaseDate: date }, { merge: true });
        console.log(`Denormalized latest version ${version} to parent app document.`);

    } catch (error) {
        console.error("Error adding changelog: ", error);
        alertMessage("Failed to add changelog.", 'error');
    }
};
window.addChangelogEntry = addChangelogEntry;

const deleteChangelogEntry = async (appId, logId, version) => {
     if (!isAuthenticatedAdmin) return alertMessage("Access Denied: Must be signed in.", 'error');
     
     // Removed confirm() compliance fix
     if (!confirm(`Are you sure you want to delete changelog entry "${version}"? This action cannot be undone.`)) {
        return;
    }             try {
        const LOG_DOC_PATH = `${AppsCollection}/${appId}/changelog/${logId}`;
        await deleteDoc(doc(db, LOG_DOC_PATH));
        alertMessage(`Changelog entry ${version} deleted.`, 'success');
    } catch (error) {
        console.error("Error deleting changelog: ", error);
        alertMessage("Failed to delete changelog.", 'error');
    }
};
window.deleteChangelogEntry = deleteChangelogEntry;


// --- Developer Profile Logic ---
const setupProfileListener = () => {
    if (!isAuthenticatedAdmin || !isAuthReady) return;
    // Use the simplified doc reference
    const docRef = doc(db, DeveloperProfileDoc);

    onSnapshot(docRef, (doc) => {
        if (doc.exists()) {
            renderProfile(doc.data());
        } else {
            renderProfile({}); 
        }
    }, (error) => {
        console.error("Error fetching profile: ", error);
        alertMessage("Error loading profile: " + error.message, 'error');
    });
};

const renderProfile = (profile) => {
    document.getElementById('profile-name').value = profile.name || '';
    document.getElementById('profile-age').value = profile.age || '';
    document.getElementById('profile-city').value = profile.city || '';
    document.getElementById('profile-phone').value = profile.phone || '';
    // Using 'email' field as per schema
    document.getElementById('profile-email').value = profile.email || ''; 
    document.getElementById('profile-bio').value = profile.bio || '';
    document.getElementById('profile-skills').value = Array.isArray(profile.skills) ? profile.skills.join(', ') : '';
    document.getElementById('profile-links').value = Array.isArray(profile.links) ? profile.links.join(', ') : '';
    renderProfilePicture(profile.profileImageUrl);
};

document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isAuthenticatedAdmin) return alertMessage("Access Denied: Must be signed in.", 'error');

    const skillsInput = document.getElementById('profile-skills').value.trim();
    const linksInput = document.getElementById('profile-links').value.trim();

    const profileData = {
        name: document.getElementById('profile-name').value.trim(),
        age: parseInt(document.getElementById('profile-age').value, 10) || null,
        city: document.getElementById('profile-city').value.trim(),
        phone: document.getElementById('profile-phone').value.trim(),
        // Using 'email' field as per schema
        email: document.getElementById('profile-email').value.trim(),
        bio: document.getElementById('profile-bio').value.trim(),
        skills: skillsInput ? skillsInput.split(',').map(s => s.trim()).filter(s => s) : [],
        links: linksInput ? linksInput.split(',').map(s => s.trim()).filter(s => s) : [],
        profileImageUrl: document.getElementById('profile-image-preview').src.startsWith('http') && !document.getElementById('profile-image-preview').src.includes('placehold.co') ? document.getElementById('profile-image-preview').src : null, // Only save if it's a real URL
        updatedAt: serverTimestamp(),
    };

    if (!profileData.name || !profileData.email) {
        alertMessage('Name and Email are required fields.', 'error');
        return;
    }

    try {
        // Use the simplified doc reference
        const docRef = doc(db, DeveloperProfileDoc);
        await setDoc(docRef, profileData, { merge: true });
        alertMessage(`Developer Profile saved successfully!`, 'success');
    } catch (error) {
        console.error("Error saving profile: ", error);
        alertMessage(`Failed to save profile: ${error.message}`, 'error');
    }
});

// --- Profile Picture Upload Logic ---
const PROFILE_IMAGE_PATH = `artifacts/${appId}/public/data/developerProfile/profile.png`; // Fixed name for easy overwrite
let profileUploadTask = null; // To manage ongoing uploads
let cropper = null; // To hold the Cropper.js instance

const renderProfilePicture = (imageUrl) => {
    const preview = document.getElementById('profile-image-preview');
    const deleteBtn = document.getElementById('delete-profile-image-btn');
    if (imageUrl) {
        preview.src = imageUrl;
        deleteBtn.disabled = false;
    } else {
        preview.src = "https://placehold.co/128x128/1E1E2F/4AC0FF?text=No+Image";
        deleteBtn.disabled = true;
    }
    safeCreateIcons();
};

const openCropperModal = (imageFile) => {
    const modal = document.getElementById('cropper-modal');
    const image = document.getElementById('cropper-image');
    const reader = new FileReader();

    reader.onload = (e) => {
        image.src = e.target.result;
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        if (cropper) {
            cropper.destroy();
        }
        cropper = new Cropper(image, {
            aspectRatio: 1 / 1,
            viewMode: 1,
            background: false,
            autoCropArea: 0.8,
        });
    };
    reader.readAsDataURL(imageFile);
};

const closeCropperModal = () => {
    const modal = document.getElementById('cropper-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    if (cropper) {
        cropper.destroy();
        cropper = null;
    }
};

const handleProfilePictureUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    openCropperModal(file);
};

const saveCroppedImage = () => {
    if (!cropper) return;

    cropper.getCroppedCanvas({ width: 512, height: 512 }).toBlob(async (blob) => {
        closeCropperModal();

        const storageRef = ref(storage, PROFILE_IMAGE_PATH);
        profileUploadTask = uploadBytesResumable(storageRef, blob);

        const progressContainer = document.getElementById('profile-upload-progress-container');
        const progressBar = document.getElementById('profile-upload-progress-bar');
        const statusText = document.getElementById('profile-image-status');
        const cancelBtn = document.getElementById('cancel-profile-upload-btn');

        progressContainer.classList.remove('hidden');
        cancelBtn.classList.remove('hidden');
        statusText.textContent = `Uploading cropped image...`;

        profileUploadTask.on('state_changed',
            (snapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                progressBar.style.width = progress + '%';
                statusText.textContent = `Uploading: ${progress.toFixed(0)}%`;
            },
            (error) => {
                console.error("Profile picture upload failed:", error);
                alertMessage(`Upload failed: ${error.code}`, 'error');
                progressContainer.classList.add('hidden');
                cancelBtn.classList.add('hidden');
                statusText.textContent = 'Upload failed.';
                profileUploadTask = null;
            },
            async () => {
                const downloadURL = await getDownloadURL(profileUploadTask.snapshot.ref);
                const profileRef = doc(db, DeveloperProfileDoc);
                await setDoc(profileRef, { profileImageUrl: downloadURL }, { merge: true });
                
                alertMessage('Profile picture uploaded and saved!', 'success');
                progressContainer.classList.add('hidden');
                cancelBtn.classList.add('hidden');
                statusText.textContent = 'Upload complete.';
                renderProfilePicture(downloadURL);
                profileUploadTask = null;
            }
        );
    }, 'image/png');
};

const deleteProfilePicture = async () => {
    if (!confirm('Are you sure you want to delete your profile picture?')) return;
    try {
        const imageRef = ref(storage, PROFILE_IMAGE_PATH);
        await deleteObject(imageRef);
        const profileRef = doc(db, DeveloperProfileDoc);
        await setDoc(profileRef, { profileImageUrl: null }, { merge: true }); // Remove URL from Firestore
        alertMessage('Profile picture deleted successfully.', 'success');
        renderProfilePicture(null); // Clear preview
    } catch (error) {
        console.error("Error deleting profile picture:", error);
        alertMessage(`Deletion failed: ${error.message}. The file may already be deleted.`, 'error');
    }
};

const cancelProfileUpload = () => {
    if (profileUploadTask) {
        profileUploadTask.cancel();
        profileUploadTask = null;
        document.getElementById('profile-upload-progress-container').classList.add('hidden');
        document.getElementById('cancel-profile-upload-btn').classList.add('hidden');
        document.getElementById('profile-image-status').textContent = 'Upload cancelled.';
        alertMessage('Profile picture upload cancelled.', 'info');
    }
};

// Attach event listeners AFTER the functions are defined
document.getElementById('profile-image-upload').addEventListener('change', (e) => handleProfilePictureUpload(e));
document.getElementById('delete-profile-image-btn').addEventListener('click', deleteProfilePicture);
document.getElementById('cancel-profile-upload-btn').addEventListener('click', cancelProfileUpload);
document.getElementById('cropper-cancel-btn').addEventListener('click', closeCropperModal);
document.getElementById('cropper-save-btn').addEventListener('click', saveCroppedImage);


// Ensure the profile picture upload input is cleared after selection
document.getElementById('profile-image-upload').addEventListener('click', (e) => {
    e.target.value = '';
});


// --- Featured App Logic ---
const setFeaturedApp = async (appId, appName) => {
    if (!isAuthenticatedAdmin) return alertMessage("Access Denied.", 'error');

    if (!confirm(`Are you sure you want to set "${appName}" as the featured app?`)) return;

    try {
        const profileRef = doc(db, DeveloperProfileDoc);
        await setDoc(profileRef, { featuredAppId: appId }, { merge: true });
        alertMessage(`"${appName}" is now the featured app.`, 'success');
    } catch (error) {
        console.error("Error setting featured app:", error);
        alertMessage(`Failed to set featured app: ${error.message}`, 'error');
    }
};
window.setFeaturedApp = setFeaturedApp;

const duplicateApp = async (appId) => {
    if (!isAuthenticatedAdmin) return alertMessage("Access Denied.", 'error');

    const originalApp = appsState.get(appId);
    if (!originalApp) return alertMessage("Original app not found.", 'error');

    if (!confirm(`Are you sure you want to duplicate the app "${originalApp.name}"?`)) return;

    // Create a copy, removing ID and modifying the name
    const newAppData = { ...originalApp };
    delete newAppData.id; // Remove the original ID
    newAppData.name = `${originalApp.name} - Copy`;
    newAppData.createdAt = serverTimestamp();
    newAppData.updatedAt = serverTimestamp();
    
    // We don't copy screenshots or changelogs to keep it clean
    newAppData.screenshots = [];

    // Open the modal with the pre-filled data, but without an ID, so it saves as a new app
    openAppModal(null, newAppData);
};
window.duplicateApp = duplicateApp;

// --- CRUD Functions for Apps ---
const saveApp = async (appData, docId) => {
    if (!isAuthenticatedAdmin) return alertMessage("Access Denied: Must be signed in.", 'error');

    const isNew = !docId;
    const actionText = isNew ? 'Adding' : 'Updating';

    try {
        const dataToSave = {
            ...appData,
            updatedAt: serverTimestamp(),
        };

        // Category Reference creation
        const categoryRefPath = appData.categoryPath; // FIX: appData.categoryPath already contains the full path

        if (isNew) {
            dataToSave.createdAt = serverTimestamp();
            dataToSave.category = doc(db, categoryRefPath); // Create a document reference from the correct path
        } else {
            const docRef = doc(db, AppsCollection, docId);
            const existingDoc = await getDoc(docRef);
            if (existingDoc.exists()) {
                const existingData = existingDoc.data();
                
                // Check if category path changed to update the reference
                if (categoryRefPath !== existingData.category.path) {
                     dataToSave.category = doc(db, categoryRefPath);
                } else {
                     dataToSave.category = existingData.category; 
                }

                dataToSave.createdAt = existingData.createdAt; 
            }
        }
        
        delete dataToSave.categoryPath; 
        
        let finalDocId = docId;

        if (isNew) {
            const newDocRef = await addDoc(collection(db, AppsCollection), dataToSave);
            finalDocId = newDocRef.id; // Capture the new ID
            alertMessage(`App "${appData.name}" added successfully!`, 'success');
        } else {
            await setDoc(doc(db, AppsCollection, docId), dataToSave, { merge: true });
            alertMessage(`App "${appData.name}" updated successfully!`, 'success');
        }
        
        // FIX: Handle featured app status *after* the app is saved and we have a guaranteed ID.
        if (appData.isFeatured && finalDocId) {
            const profileRef = doc(db, DeveloperProfileDoc);
            await setDoc(profileRef, { featuredAppId: finalDocId }, { merge: true });
            alertMessage(`"${appData.name}" set as featured app.`, 'success');
        } else if (!appData.isFeatured && finalDocId) {
            const profileRef = doc(db, DeveloperProfileDoc);
            const profileSnap = await getDoc(profileRef);
            if (profileSnap.exists() && profileSnap.data().featuredAppId === finalDocId) {
                await setDoc(profileRef, { featuredAppId: null }, { merge: true });
                alertMessage(`"${appData.name}" is no longer featured.`, 'info');
            }
        }
        closeAppModal();

    } catch (error) {
        console.error(`Error ${actionText} document: `, error);
        alertMessage(`Failed to ${actionText.toLowerCase().slice(0, -3)} app: ${error.message}`, 'error');
    }
};

const deleteApp = async (docId, appName) => {
    if (!isAuthenticatedAdmin) return alertMessage("Access Denied: Must be signed in.", 'error');

    openConfirmationModal(
        `This action cannot be undone. This will permanently delete the app "${appName}" and all of its data, including changelogs and screenshots. Please type the app's name to confirm.`,
        appName,
        async () => {
            await deleteDoc(doc(db, AppsCollection, docId));
            alertMessage(`App "${appName}" deleted successfully.`, 'success');
        }
    );
};
window.deleteApp = deleteApp;

// --- Modal Tab UI Logic ---
const switchModalTab = (tabName) => {
    const detailsTab = document.getElementById('modal-tab-details');
    const changelogTab = document.getElementById('modal-tab-changelog');
    const detailsSection = document.getElementById('modal-details-section');
    const changelogSection = document.getElementById('modal-changelog-section');

    if (tabName === 'details') {
        detailsTab.classList.add('text-accent-blue', 'border-accent-blue');
        detailsTab.classList.remove('text-gray-400', 'border-transparent');
        changelogTab.classList.add('text-gray-400', 'border-transparent');
        changelogTab.classList.remove('text-accent-blue', 'border-accent-blue');
        detailsSection.classList.remove('hidden');
        changelogSection.classList.add('hidden');
    } else if (tabName === 'changelog') {
        changelogTab.classList.add('text-accent-blue', 'border-accent-blue');
        changelogTab.classList.remove('text-gray-400', 'border-transparent');
        detailsTab.classList.add('text-gray-400', 'border-transparent');
        detailsTab.classList.remove('text-accent-blue', 'border-accent-blue');
        changelogSection.classList.remove('hidden');
        detailsSection.classList.add('hidden');
    }
};
window.switchModalTab = switchModalTab;


// --- UI Rendering for Apps ---
const renderApps = (apps) => {
    const listContainer = document.getElementById('apps-list');
    const profileDocRef = doc(db, DeveloperProfileDoc);
    listContainer.innerHTML = '';
    
    if (apps.length === 0) {
        document.getElementById('empty-state').classList.remove('hidden');
    } else {
        document.getElementById('empty-state').classList.add('hidden');
        getDoc(profileDocRef).then(profileSnap => {
            const featuredAppId = profileSnap.exists() ? profileSnap.data().featuredAppId : null;
            listContainer.innerHTML = ''; // Clear again before rendering

            apps.forEach(app => {
                const isFeatured = app.id === featuredAppId;
                const card = document.createElement('div');
                card.className = `cms-card p-6 rounded-xl transition duration-300 flex flex-col space-y-4 ${isFeatured ? 'border-2 border-yellow-400' : ''}`;
                
                const categoryPath = app.category && app.category.path ? app.category.path : '/categories/N/A';
                const categoryKey = categoryPath.split('/').pop() || 'N/A';
                const iconName = app.icon || 'star';

                card.innerHTML = `
                    <div class="flex items-start justify-between">
                        <div class="flex items-center space-x-4">
                            <div class="p-3 rounded-xl" style="background-color:rgba(74, 192, 255, 0.1);">
                                <i data-lucide="${iconName}" class="w-8 h-8" style="color:var(--accent-blue)"></i>
                            </div>
                            <div>
                                <h3 class="text-xl font-bold">${app.name || 'Untitled App'}</h3>
                                <p class="text-gray-400 text-sm font-light">${app.tagline || 'No tagline provided.'}</p>
                            </div>
                        </div>
                        <span class="text-xs font-mono px-3 py-1 rounded-full bg-gray-700 text-gray-300">${app.version || 'v1.0'}</span>
                    </div>

                    <div class="flex justify-between items-center text-xs text-gray-500 pt-2 border-t border-gray-700">
                        <div class="space-y-1">
                            <p>Downloads: <span class="text-gray-300 font-medium">${app.downloads ? app.downloads.toLocaleString() : 0}</span></p>
                            <p>Category: <span class="text-blue-400 font-mono">${categoryKey}</span></p>
                        </div>
                        <div class="flex items-center space-x-1">
                            ${renderRating(app.rating || 0)}
                            <span class="text-gray-400 ml-1">(${app.rating !== undefined ? app.rating.toFixed(1) : '0.0'})</span>
                        </div>
                    </div>
                    
                    <p class="text-gray-500 text-xs line-clamp-3 flex-grow">${app.description || '...No description...'}</p>

                    <div class="flex justify-end space-x-2 mt-4">
                        <button onclick="duplicateApp('${app.id}')" class="py-1 px-3 text-sm text-green-300 border border-green-600 rounded-lg hover:bg-green-900 transition flex items-center" title="Duplicate App">
                            <i data-lucide="copy" class="w-4 h-4 mr-1"></i> Duplicate
                        </button>
                        <button onclick="setFeaturedApp('${app.id}', '${app.name.replace(/'/g, "\\'")}')" class="py-1 px-3 text-sm ${isFeatured ? 'text-yellow-300 border-yellow-500' : 'text-gray-400 border-gray-600'} rounded-lg hover:bg-yellow-900 transition flex items-center" title="Set as Featured App">
                            <i data-lucide="star" class="w-4 h-4 mr-1 ${isFeatured ? 'fill-current' : ''}"></i> Feature
                        </button>
                        <button onclick="openAppModal('${app.id}')" class="py-1 px-3 text-sm text-blue-300 border border-blue-600 rounded-lg hover:bg-blue-900 transition flex items-center">
                            <i data-lucide="edit" class="w-4 h-4 mr-1"></i> Edit
                        </button>
                        <button onclick="deleteApp('${app.id}', \`${app.name.replace(/`/g, "\\`")}\`)" class="py-1 px-3 text-sm text-red-300 border border-red-600 rounded-lg hover:bg-red-900 transition flex items-center">
                            <i data-lucide="trash-2" class="w-4 h-4 mr-1"></i> Delete
                        </button>
                    </div>
                `;
                listContainer.appendChild(card);
            });
            safeCreateIcons();
        });
    }
};


// --- Modal Control for Apps ---
const openAppModal = async (id = null, prefillData = null) => {
    if (!isAuthenticatedAdmin) return alertMessage("Access Denied: Must be signed in.", 'error');

    const modal = document.getElementById('app-modal');
    const form = document.getElementById('app-form');
    // Use prefillData if provided (for duplication), otherwise get from state or use empty object
    const appData = prefillData || (id ? appsState.get(id) : {});

    form.reset(); 
    currentAppId = id; 

    const categoryPath = appData.category && appData.category.path ? appData.category.path : `${PUBLIC_BASE}/categories/misc`;
    // Get category key from the path, after the last slash
    const categoryKey = categoryPath.split('/').pop(); 
    const screenshotsArray = Array.isArray(appData.screenshots) ? appData.screenshots : [];

    // Helper to format Firestore Timestamp to YYYY-MM-DD for date input
    const toInputDate = (timestamp) => {
        if (!timestamp) return new Date().toISOString().split('T')[0]; // Default to today for new apps
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toISOString().split('T')[0];
    };

    const profileSnap = await getDoc(doc(db, DeveloperProfileDoc));
    const featuredAppId = profileSnap.exists() ? profileSnap.data().featuredAppId : null;

    // Reset to the details tab by default
    switchModalTab('details');
    
    // Populate the icon dropdown
    const iconSelect = document.getElementById('icon');
    iconSelect.innerHTML = lucideIconOptions.map(iconName => 
        `<option value="${iconName}">${iconName.charAt(0).toUpperCase() + iconName.slice(1).replace(/-/g, ' ')}</option>`
    ).join('');

    if (id || prefillData) {
        document.getElementById('modal-title').textContent = 'Edit App';
        document.getElementById('modal-submit-btn').textContent = 'Update App';
        document.getElementById('app-id').value = id;
        document.getElementById('name').value = appData.name || '';
        document.getElementById('tagline').value = appData.tagline || '';
        document.getElementById('icon').value = appData.icon || 'rocket';
        document.getElementById('version').value = appData.version || '1.0.0';
        document.getElementById('rating').value = appData.rating !== undefined ? appData.rating : 0;
        document.getElementById('downloads').value = appData.downloads !== undefined ? appData.downloads : 0;
        document.getElementById('description').value = appData.description || '';
        document.getElementById('categoryRef').value = categoryKey; 
        document.getElementById('screenshots').value = screenshotsArray.join(', ');
        document.getElementById('apkUrl').value = appData.apkUrl || '';
        document.getElementById('playStoreUrl').value = appData.playStoreUrl || '';
        document.getElementById('releaseDate').value = toInputDate(appData.releaseDate);
        document.getElementById('isFeatured').checked = (id && id === featuredAppId);

        // Enable and show changelog tab
        document.getElementById('modal-tab-changelog').disabled = false;
        document.getElementById('modal-tab-changelog').classList.remove('opacity-50', 'cursor-not-allowed');
        
        if (id) { // Only setup listeners and uploads for existing apps
            setupChangelogListener(id); 
            enableScreenshotUploads(id);
        } else { // This is a duplicated app, so disable these
            disableScreenshotUploads();
            if (unsubscribeChangelog) unsubscribeChangelog();
        }
    } else {
        document.getElementById('modal-title').textContent = 'Add New App';
        document.getElementById('modal-submit-btn').textContent = 'Save App';
        document.getElementById('app-id').value = '';
        document.getElementById('categoryRef').value = 'misc';
        document.getElementById('screenshots').value = '';
        document.getElementById('icon').value = 'rocket';
        document.getElementById('changelog-date').value = new Date().toISOString().split('T')[0];
        document.getElementById('releaseDate').value = toInputDate(null);
        document.getElementById('isFeatured').checked = false;

        // Disable and hide changelog tab for new apps
        document.getElementById('modal-tab-changelog').disabled = true;
        document.getElementById('modal-tab-changelog').classList.add('opacity-50', 'cursor-not-allowed');
        disableScreenshotUploads();

        if (unsubscribeChangelog) unsubscribeChangelog();
    }

    modal.classList.remove('hidden', 'opacity-0');
    modal.classList.add('flex', 'opacity-100');
};

const closeAppModal = () => {
    const modal = document.getElementById('app-modal');
    modal.classList.remove('flex', 'opacity-100');
    modal.classList.add('hidden', 'opacity-0');
    currentAppId = null;
    if (unsubscribeChangelog) unsubscribeChangelog();
};

// Expose to global scope for HTML calls
window.openAppModal = openAppModal;
window.closeAppModal = closeAppModal;

// --- Screenshot Upload and Management Logic ---

const renderScreenshotsGallery = (appId, screenshotUrls) => {
    const gallery = document.getElementById('screenshots-gallery');
    gallery.innerHTML = '';
    if (!screenshotUrls || screenshotUrls.length === 0) {
        gallery.innerHTML = '<p class="col-span-full text-sm text-gray-500">No screenshots uploaded yet.</p>';
        return;
    }

    screenshotUrls.forEach((url, index) => {
        const thumb = document.createElement('div');
        thumb.className = 'relative group cursor-move';
        thumb.dataset.url = url; // Store URL in a data attribute for reordering
        thumb.innerHTML = `
            <img src="${url}" alt="Screenshot ${index + 1}" class="w-full h-24 object-cover rounded-lg border border-gray-600">
            <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-60 transition-all duration-300 flex items-center justify-center rounded-lg">
                <button type="button" onclick="deleteScreenshot('${appId}', '${url}')" class="p-2 bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 transform scale-75 group-hover:scale-100 cursor-pointer">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </div>
        `;
        gallery.appendChild(thumb);
    });
    safeCreateIcons();

    // Initialize SortableJS
    new Sortable(gallery, {
        animation: 150,
        ghostClass: 'bg-blue-500/30',
        onEnd: async (evt) => {
            const newOrder = Array.from(evt.to.children).map(child => child.dataset.url).filter(Boolean);
            
            // Update Firestore with the new order
            try {
                const appRef = doc(db, AppsCollection, appId);
                await setDoc(appRef, { screenshots: newOrder }, { merge: true });
                alertMessage('Screenshot order saved!', 'success');
            } catch (error) {
                console.error("Error reordering screenshots:", error);
                alertMessage('Failed to save new order.', 'error');
            }
        }
    });
};

const enableScreenshotUploads = (appDocumentId) => {
    const uploadInput = document.getElementById('screenshot-upload');
    const message = document.getElementById('upload-disabled-message');
    uploadInput.disabled = false;
    message.classList.add('hidden');

    // Render existing screenshots
    const appData = appsState.get(appDocumentId) || {};
    renderScreenshotsGallery(appDocumentId, appData.screenshots || []);

    uploadInput.onchange = (e) => handleFileUpload(e, appDocumentId);
};

const disableScreenshotUploads = () => {
    const uploadInput = document.getElementById('screenshot-upload');
    const message = document.getElementById('upload-disabled-message');
    const gallery = document.getElementById('screenshots-gallery'); // This line is fine
    uploadInput.disabled = true;
    message.classList.remove('hidden');
    gallery.innerHTML = '';
    uploadInput.onchange = null;
};

const handleFileUpload = (event, appDocumentId) => {
    const files = event.target.files;
    if (!files.length || !appDocumentId) return;

    const file = files[0]; // Handle one file at a time for clearer progress
    // Align storage path with Firestore structure for consistent security rules
    const storagePath = `artifacts/${appId}/public/data/apps/${appDocumentId}/screenshots/${Date.now()}-${file.name}`;
    const storageRef = ref(storage, storagePath);
    const uploadTask = uploadBytesResumable(storageRef, file);

    const progressContainer = document.getElementById('upload-progress-container');
    const progressBar = document.getElementById('upload-progress-bar');
    progressContainer.classList.remove('hidden');

    uploadTask.on('state_changed', 
        (snapshot) => {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            progressBar.style.width = progress + '%';
        }, 
        (error) => {
            console.error("Upload failed:", error);
            alertMessage(`Upload failed: ${error.code}`, 'error');
            progressContainer.classList.add('hidden');
        }, 
        async () => {
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            const appRef = doc(db, AppsCollection, appDocumentId);
            const appDoc = await getDoc(appRef);
            const existingScreenshots = appDoc.data().screenshots || [];
            
            await setDoc(appRef, { screenshots: [...existingScreenshots, downloadURL] }, { merge: true });
            
            alertMessage('Screenshot uploaded and saved!', 'success');
            progressContainer.classList.add('hidden');
            // The realtime listener will automatically re-render the gallery
        }
    );
};

window.deleteScreenshot = async (appDocumentId, urlToDelete) => {
    if (!confirm('Are you sure you want to delete this screenshot?')) return;
    try {
        const imageRef = ref(storage, urlToDelete);
        await deleteObject(imageRef);
        const appRef = doc(db, AppsCollection, appDocumentId);
        const appDoc = await getDoc(appRef);
        const updatedScreenshots = (appDoc.data().screenshots || []).filter(url => url !== urlToDelete);
        await setDoc(appRef, { screenshots: updatedScreenshots }, { merge: true });
        alertMessage('Screenshot deleted successfully.', 'success');
    } catch (error) {
        console.error("Error deleting screenshot:", error);
        alertMessage(`Deletion failed: ${error.message}. The file may already be deleted.`, 'error');
    }
};

// --- Form Submission Handler for Apps ---
document.getElementById('app-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!isAuthenticatedAdmin) return alertMessage("Access Denied: Must be signed in.", 'error');

    const docId = document.getElementById('app-id').value;
    // The input is just the key (e.g., 'games'), so we build the reference path string.
    const categoryKey = document.getElementById('categoryRef').value.trim() || `misc`; 
    const categoryPath = `${PUBLIC_BASE}/categories/${categoryKey}`;
    
    const releaseDate = new Date(document.getElementById('releaseDate').value);

    // Get existing screenshots from the app state to preserve them on save.
    const currentAppData = docId ? appsState.get(docId) : {};
    const existingScreenshots = currentAppData.screenshots || [];

    const appData = {
        name: document.getElementById('name').value,
        tagline: document.getElementById('tagline').value,
        icon: document.getElementById('icon').value, // Value from select dropdown
        version: document.getElementById('version').value,
        rating: parseFloat(document.getElementById('rating').value),
        downloads: parseInt(document.getElementById('downloads').value, 10),
        description: document.getElementById('description').value,
        apkUrl: document.getElementById('apkUrl').value.trim(),
        playStoreUrl: document.getElementById('playStoreUrl').value.trim(),
        screenshots: existingScreenshots, // Preserve existing screenshots on save
        categoryPath: categoryPath,
        releaseDate: releaseDate,
        isFeatured: document.getElementById('isFeatured').checked,
    };

    if (isNaN(appData.rating) || appData.rating < 0 || appData.rating > 5) {
        alertMessage('Rating must be a number between 0 and 5.', 'error');
        return;
    }
    if (isNaN(appData.downloads) || appData.downloads < 0) {
        alertMessage('Downloads must be a positive integer.', 'error');
        return;
    }
    
    if (categoryKey.includes('/') || categoryKey.includes('.') || categoryKey.includes(' ')) {
        alertMessage('Category Key should be a simple ID (e.g., "games" or "c1"), no slashes or spaces.', 'error');
        return;
    }

    saveApp(appData, docId || null);
});

// Start the application
window.onload = initializeFirebase;