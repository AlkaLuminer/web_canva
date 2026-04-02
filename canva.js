'use strict';

// ── CANVAS DIMENSIONS ────────────────────────────────────────────────────────

const canvas_width  = 1200;
const canvas_height = 750;

// ── CANVAS ELEMENTS ──────────────────────────────────────────────────────────

const image_canvas   = document.getElementById('imageCanvas');
const draw_layer_0   = document.getElementById('layer0');
const draw_layer_1   = document.getElementById('layer1');
const draw_layer_2   = document.getElementById('layer2');
const preview_canvas = document.getElementById('previewCanvas');
const draw_layers    = [draw_layer_0, draw_layer_1, draw_layer_2];

function set_canvas_size(canvas) {
    canvas.width  = canvas_width;
    canvas.height = canvas_height;
}

[image_canvas, draw_layer_0, draw_layer_1, draw_layer_2, preview_canvas].forEach(set_canvas_size);

const canvas_wrapper  = document.getElementById('canvas-wrapper');
canvas_wrapper.style.width  = canvas_width  + 'px';
canvas_wrapper.style.height = canvas_height + 'px';

const image_context   = image_canvas.getContext('2d');
const layer_contexts  = draw_layers.map(layer => layer.getContext('2d'));
const preview_context = preview_canvas.getContext('2d');

// ── ZOOM AND PAN STATE ───────────────────────────────────────────────────────

const viewport  = document.getElementById('canvas-viewport');
const scene     = document.getElementById('canvas-scene');
let zoom        = 1;
let pan_x       = 0;
let pan_y       = 0;
let is_panning  = false;
let pan_start   = null;
let space_down  = false;

function apply_transform() {
    scene.style.transform = `translate(${ pan_x }px, ${ pan_y }px) scale(${ zoom })`;
    const zoom_label = document.getElementById('zoomLabel');
    if (zoom_label) {
        const zoom_text = Math.round(zoom * 100) + '%';
        zoom_label.value       = zoom_text;
        zoom_label.textContent = zoom_text;
    }
    document.getElementById('zoomStatus').textContent   =
        `Zoom: ${ Math.round(zoom * 100) }%  ·  Scroll to zoom  ·  Space + drag to pan`;
}

function fit_canvas_to_screen() {
    const cw            = typeof current_canvas_width  !== 'undefined' ? current_canvas_width  : canvas_width;
    const ch            = typeof current_canvas_height !== 'undefined' ? current_canvas_height : canvas_height;
    const available_width  = viewport.clientWidth  - 60;
    const available_height = viewport.clientHeight - 60;
    zoom  = Math.min(available_width / cw, available_height / ch, 1);
    pan_x = (viewport.clientWidth  - cw * zoom) / 2;
    pan_y = (viewport.clientHeight - ch * zoom) / 2;
    apply_transform();
}

window.addEventListener('load', () => {
    fit_canvas_to_screen();
    draw_paper_texture();
});

document.getElementById('zoomInBtn').addEventListener('click',  () => set_zoom(zoom * 1.25));
document.getElementById('zoomOutBtn').addEventListener('click', () => set_zoom(zoom / 1.25));
document.getElementById('zoomFitBtn').addEventListener('click', fit_canvas_to_screen);

// Allow typing a zoom value directly into the zoom label input.
document.getElementById('zoomLabel').addEventListener('change', event => {
    const raw   = event.target.value.replace('%', '').trim();
    const value = parseFloat(raw);
    if (!isNaN(value) && value > 0) set_zoom(value / 100);
    else event.target.value = Math.round(zoom * 100) + '%';
});
document.getElementById('zoomLabel').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.target.blur(); }
});

function set_zoom(new_zoom_value, center_x, center_y) {
    const clamped_zoom = Math.max(0.1, Math.min(5, new_zoom_value));
    if (center_x !== undefined) {
        pan_x = center_x - (center_x - pan_x) * (clamped_zoom / zoom);
        pan_y = center_y - (center_y - pan_y) * (clamped_zoom / zoom);
    }
    zoom = clamped_zoom;
    apply_transform();
}

viewport.addEventListener('wheel', event => {
    event.preventDefault();
    const bounds       = viewport.getBoundingClientRect();
    const cursor_x     = event.clientX - bounds.left;
    const cursor_y     = event.clientY - bounds.top;
    const zoom_factor  = event.deltaY < 0 ? 1.1 : 0.9;
    set_zoom(zoom * zoom_factor, cursor_x, cursor_y);
}, { passive: false });

document.addEventListener('keydown', event => {
    if (event.code === 'Space' && !event.target.matches('input, textarea')) {
        event.preventDefault();
        space_down = true;
        viewport.classList.add('pan-mode');
    }
    if (event.ctrlKey && event.key === 'z') { event.preventDefault(); undo(); }
    if (event.ctrlKey && event.key === 'y') { event.preventDefault(); redo(); }
});

document.addEventListener('keyup', event => {
    if (event.code === 'Space') {
        space_down = false;
        viewport.classList.remove('pan-mode');
        viewport.classList.remove('panning');
    }
});

viewport.addEventListener('mousedown', event => {
    if (space_down || active_tool === 'pan') {
        is_panning = true;
        pan_start  = { mouse_x: event.clientX, mouse_y: event.clientY, start_pan_x: pan_x, start_pan_y: pan_y };
        viewport.classList.add('panning');
        event.preventDefault();
    }
});

document.addEventListener('mousemove', event => {
    if (is_panning && pan_start) {
        pan_x = pan_start.start_pan_x + (event.clientX - pan_start.mouse_x);
        pan_y = pan_start.start_pan_y + (event.clientY - pan_start.mouse_y);
        apply_transform();
    }
});

document.addEventListener('mouseup', () => {
    if (is_panning) {
        is_panning = false;
        pan_start  = null;
        viewport.classList.remove('panning');
    }
});

function viewport_to_canvas(client_x, client_y) {
    const bounds          = viewport.getBoundingClientRect();
    const viewport_x      = client_x - bounds.left;
    const viewport_y      = client_y - bounds.top;
    return {
        x: (viewport_x - pan_x) / zoom,
        y: (viewport_y - pan_y) / zoom,
    };
}

// ── DRAWING STATE ────────────────────────────────────────────────────────────

let active_tool      = 'pencil';
let active_layer     = 0;
let stroke_color     = '#1a1a2e';
let fill_color       = '#ffffff';
let brush_size       = 4;
let draw_opacity     = 1;
let use_fill         = false;
let brush_shape      = 'round';   // round | square | calligraphy | spray
let is_drawing       = false;
let start_x, start_y, last_x, last_y;
let draw_sound_on    = true;
let music_on         = false;
let pencil_path      = [];

// ── UNIFIED UNDO AND REDO ────────────────────────────────────────────────────
// Each entry holds: { layers: [ImageData, ImageData, ImageData], images: [...snapshot objects] }

const undo_stack     = [];
const redo_stack     = [];
const max_undo_steps = 30;

function snapshot_images() {
    return image_list.map(image_object => {
        const pixel_data = image_object.offscreen_context.getImageData(
            0, 0,
            image_object.offscreen_canvas.width,
            image_object.offscreen_canvas.height
        );
        const erase_data = image_object.erase_context.getImageData(
            0, 0,
            image_object.erase_canvas.width,
            image_object.erase_canvas.height
        );
        return {
            id:                image_object.id,
            position:          { ...image_object.position },
            is_visible:        image_object.is_visible,
            is_erasable:       image_object.is_erasable,
            name:              image_object.name,
            layer:             image_object.layer,
            source_data_url:   image_object.source_data_url,
            pixel_data,
            erase_data,
            offscreen_width:   image_object.offscreen_canvas.width,
            offscreen_height:  image_object.offscreen_canvas.height,
            erase_width:       image_object.erase_canvas.width,
            erase_height:      image_object.erase_canvas.height,
        };
    });
}

function snapshot_layers() {
    return layer_contexts.map((context, index) =>
        context.getImageData(0, 0, draw_layers[index].width, draw_layers[index].height)
    );
}

function save_undo() {
    undo_stack.push({ layers: snapshot_layers(), images: snapshot_images() });
    if (undo_stack.length > max_undo_steps) undo_stack.shift();
    redo_stack.length = 0;
}

function restore_snapshot(snapshot) {
    // Restore drawing layers
    snapshot.layers.forEach((image_data, index) => {
        layer_contexts[index].putImageData(image_data, 0, 0);
    });

    // Restore image list
    image_list = snapshot.images.map(saved => {
        const offscreen_canvas  = document.createElement('canvas');
        offscreen_canvas.width  = saved.offscreen_width;
        offscreen_canvas.height = saved.offscreen_height;
        const offscreen_context = offscreen_canvas.getContext('2d');
        offscreen_context.putImageData(saved.pixel_data, 0, 0);

        const erase_canvas  = document.createElement('canvas');
        erase_canvas.width  = saved.erase_width  || saved.offscreen_width;
        erase_canvas.height = saved.erase_height || saved.offscreen_height;
        const erase_context = erase_canvas.getContext('2d');
        if (saved.erase_data) erase_context.putImageData(saved.erase_data, 0, 0);

        const source_element     = new Image();
        source_element.src       = saved.source_data_url;

        return {
            id:                 saved.id,
            source_element,
            source_data_url:    saved.source_data_url,
            position:           { ...saved.position },
            is_visible:         saved.is_visible,
            is_erasable:        saved.is_erasable,
            name:               saved.name,
            layer:              saved.layer ?? 0,
            offscreen_canvas,
            offscreen_context,
            erase_canvas,
            erase_context,
        };
    });

    // Keep the counter above any restored id
    if (image_list.length) {
        image_id_counter = Math.max(image_id_counter, ...image_list.map(image_object => image_object.id));
    }

    redraw_all_images();
    render_image_list();

    if (active_image_id && image_list.find(image_object => image_object.id === active_image_id)) {
        select_image(active_image_id);
    } else {
        active_image_id = null;
        document.getElementById('image-detail').classList.add('hidden');
        if (!image_list.length) document.getElementById('image-panel').classList.add('hidden');
    }
}

// ── MULTI IMAGE SYSTEM ───────────────────────────────────────────────────────
// Each image object: { id, source_element, position: {x,y,w,h}, is_visible,
//   is_erasable, name, offscreen_canvas, offscreen_context,
//   erase_canvas, erase_context }
//
// Design: erase_canvas is sized to the IMAGE (w x h), not the full canvas.
//   Eraser strokes are recorded in image-local coordinates (canvas_xy - pos.xy).
//   rebuild_offscreen draws the erase mask translated to the image's current
//   canvas position — so erased holes always travel with the image on move.

let image_list       = [];
let active_image_id  = null;
let image_id_counter = 0;

// Rebuild offscreen_canvas for one image from its source + erase mask.
function rebuild_offscreen(image_object) {
    const cw  = image_object.offscreen_canvas.width;
    const ch  = image_object.offscreen_canvas.height;
    const ctx = image_object.offscreen_context;
    const px  = image_object.position.x;
    const py  = image_object.position.y;
    const pw  = image_object.position.w;
    const ph  = image_object.position.h;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(image_object.source_element, px, py, pw, ph);
    // Overlay the image-local erase mask at the image's current canvas position.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(image_object.erase_canvas, px, py, pw, ph);
    ctx.globalCompositeOperation = 'source-over';
}

function redraw_all_images() {
    const cw = image_canvas.width;
    const ch = image_canvas.height;
    image_context.clearRect(0, 0, cw, ch);
    image_context.fillStyle = '#faf8f2';
    image_context.fillRect(0, 0, cw, ch);
    for (const image_object of image_list) {
        if (!image_object.is_visible) continue;
        if (typeof layer_visibility !== 'undefined' && !layer_visibility[image_object.layer]) continue;
        image_context.drawImage(image_object.offscreen_canvas, 0, 0);
    }
}

function create_image_object(image_element, name) {
    const id        = ++image_id_counter;
    const scale     = Math.min(
        (canvas_width  * 0.6) / image_element.width,
        (canvas_height * 0.6) / image_element.height,
        1
    );
    const width     = Math.round(image_element.width  * scale);
    const height    = Math.round(image_element.height * scale);
    const x         = Math.round((canvas_width  - width)  / 2);
    const y         = Math.round((canvas_height - height) / 2);

    const offscreen_canvas  = document.createElement('canvas');
    offscreen_canvas.width  = canvas_width;
    offscreen_canvas.height = canvas_height;
    const offscreen_context = offscreen_canvas.getContext('2d');

    const erase_canvas  = document.createElement('canvas');
    erase_canvas.width  = width;
    erase_canvas.height = height;
    const erase_context = erase_canvas.getContext('2d');

    const image_object = {
        id,
        source_element:   image_element,
        source_data_url:  '',
        position:         { x, y, w: width, h: height },
        is_visible:       true,
        is_erasable:      false,
        name:             name || `Image ${ id }`,
        layer:            active_layer,
        offscreen_canvas,
        offscreen_context,
        erase_canvas,
        erase_context,
    };

    offscreen_context.drawImage(image_element, x, y, width, height);

    image_list.push(image_object);
    return image_object;
}

function render_image_list() {
    const list_element = document.getElementById('image-list');
    list_element.innerHTML = '';

    for (const image_object of image_list) {
        const list_item = document.createElement('div');
        list_item.className  = 'image-list-item' + (image_object.id === active_image_id ? ' active' : '');
        list_item.dataset.id = image_object.id;

        // Thumbnail
        const thumbnail         = document.createElement('canvas');
        thumbnail.className     = 'image-list-thumbnail';
        thumbnail.width         = 140;
        thumbnail.height        = 54;
        thumbnail.getContext('2d').drawImage(image_object.offscreen_canvas, 0, 0, 140, 54);
        list_item.appendChild(thumbnail);

        // Name label
        const name_label           = document.createElement('div');
        name_label.className       = 'image-list-name';
        name_label.textContent     = image_object.name;
        list_item.appendChild(name_label);

        // Controls row
        const controls_row         = document.createElement('div');
        controls_row.className     = 'image-list-controls';

        // Visibility toggle button
        const visibility_button    = document.createElement('button');
        visibility_button.className = 'image-chip-button' + (image_object.is_visible ? ' on' : '');
        visibility_button.textContent = image_object.is_visible ? '👁 On' : '👁 Off';
        visibility_button.title    = 'Toggle visibility';
        visibility_button.addEventListener('click', event => {
            event.stopPropagation();
            image_object.is_visible              = !image_object.is_visible;
            visibility_button.textContent        = image_object.is_visible ? '👁 On' : '👁 Off';
            visibility_button.classList.toggle('on', image_object.is_visible);
            redraw_all_images();
        });

        // Erasable toggle button
        const erasable_button      = document.createElement('button');
        erasable_button.className  = 'image-chip-button' + (image_object.is_erasable ? ' on' : '');
        erasable_button.textContent = image_object.is_erasable ? '🧽 On' : '🧽 Off';
        erasable_button.title      = 'Toggle erasable';
        erasable_button.addEventListener('click', event => {
            event.stopPropagation();
            image_object.is_erasable             = !image_object.is_erasable;
            erasable_button.textContent          = image_object.is_erasable ? '🧽 On' : '🧽 Off';
            erasable_button.classList.toggle('on', image_object.is_erasable);
            if (image_object.id === active_image_id) {
                document.getElementById('imgErasable').checked = image_object.is_erasable;
            }
        });

        controls_row.appendChild(visibility_button);
        controls_row.appendChild(erasable_button);
        list_item.appendChild(controls_row);

        list_item.addEventListener('click', () => select_image(image_object.id));
        list_element.appendChild(list_item);
    }
}

function select_image(id) {
    active_image_id = id;
    const image_object = image_list.find(item => item.id === id);
    if (!image_object) return;

    render_image_list();

    // Only show edit detail panel if the image belongs to the current active layer.
    if (image_object.layer !== active_layer) {
        document.getElementById('image-detail').classList.add('hidden');
        return;
    }

    const detail_panel = document.getElementById('image-detail');
    detail_panel.classList.remove('hidden');

    document.getElementById('imgDetailTitle').textContent  = image_object.name;
    document.getElementById('imgW').value                  = Math.round(image_object.position.w);
    document.getElementById('imgH').value                  = Math.round(image_object.position.h);
    document.getElementById('imgX').value                  = Math.round(image_object.position.x);
    document.getElementById('imgY').value                  = Math.round(image_object.position.y);
    document.getElementById('imgErasable').checked         = image_object.is_erasable;
    document.getElementById('image-panel').classList.remove('hidden');
}

function get_active_image() {
    const image_object = image_list.find(item => item.id === active_image_id) || null;
    if (!image_object) return null;
    if (image_object.layer !== active_layer) return null;
    return image_object;
}

// Move image: update position and rebuild offscreen from source + erase mask.
// No pixel-shifting — erase cuts survive moves and nothing clips at canvas edges.
function move_image_to(image_object, new_x, new_y) {
    image_object.position.x = new_x;
    image_object.position.y = new_y;
    rebuild_offscreen(image_object);
}

// Full redraw from original source — only call when size/crop changes.
function redraw_active_image_from_source() {
    const image_object = get_active_image();
    if (!image_object) return;
    rebuild_offscreen(image_object);
    redraw_all_images();
}

// Image file upload
document.getElementById('imageUpload').addEventListener('change', event => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = load_event => {
        const image_element = new Image();
        image_element.onload = () => {
            const image_object           = create_image_object(image_element, file.name.replace(/\.[^.]+$/, ''));
            image_object.source_data_url = load_event.target.result;
            save_undo();
            redraw_all_images();
            render_image_list();
            select_image(image_object.id);
            document.querySelector('[data-tool="select"]').click();
        };
        image_element.src = load_event.target.result;
    };
    reader.readAsDataURL(file);
    event.target.value = '';
});

// Image width input
document.getElementById('imgW').addEventListener('change', () => {
    const image_object = get_active_image();
    if (!image_object) return;
    save_undo();
    image_object.position.w = parseInt(document.getElementById('imgW').value) || 10;
    redraw_active_image_from_source();
});

// Image height input
document.getElementById('imgH').addEventListener('change', () => {
    const image_object = get_active_image();
    if (!image_object) return;
    save_undo();
    image_object.position.h = parseInt(document.getElementById('imgH').value) || 10;
    redraw_active_image_from_source();
});

// Image x position input
document.getElementById('imgX').addEventListener('change', () => {
    const image_object = get_active_image();
    if (!image_object) return;
    save_undo();
    const new_x = parseInt(document.getElementById('imgX').value) || 0;
    move_image_to(image_object, new_x, image_object.position.y);
    redraw_all_images();
});

// Image y position input
document.getElementById('imgY').addEventListener('change', () => {
    const image_object = get_active_image();
    if (!image_object) return;
    save_undo();
    const new_y = parseInt(document.getElementById('imgY').value) || 0;
    move_image_to(image_object, image_object.position.x, new_y);
    redraw_all_images();
});

// Erasable checkbox
document.getElementById('imgErasable').addEventListener('change', event => {
    const image_object = get_active_image();
    if (!image_object) return;
    image_object.is_erasable = event.target.checked;
    render_image_list();
});

// Remove image button
document.getElementById('removeImgBtn').addEventListener('click', () => {
    save_undo();
    image_list      = image_list.filter(item => item.id !== active_image_id);
    active_image_id = null;
    document.getElementById('image-detail').classList.add('hidden');
    if (image_list.length === 0) document.getElementById('image-panel').classList.add('hidden');
    redraw_all_images();
    render_image_list();
});

// ── TOOL SELECTION ───────────────────────────────────────────────────────────

document.querySelectorAll('.tool-button').forEach(button => {
    button.addEventListener('click', () => {
        document.querySelectorAll('.tool-button').forEach(b => b.classList.remove('active'));
        button.classList.add('active');
        active_tool = button.dataset.tool;
        document.getElementById('activeTool').textContent = 'Tool: ' + button.title;
        update_cursor();
    });
});

function update_cursor() {
    viewport.className = '';
    if (active_tool === 'pan') { viewport.classList.add('pan-mode'); return; }
    const cursor_map = {
        pencil:   'pencil-cursor',
        eraser:   'eraser-cursor',
        text:     'text-cursor',
        rect:     'shape-cursor',
        circle:   'shape-cursor',
        line:     'shape-cursor',
        triangle: 'shape-cursor',
        select:   'select-cursor',
    };
    if (cursor_map[active_tool]) viewport.classList.add(cursor_map[active_tool]);
}
update_cursor();

// ── LAYER TABS ───────────────────────────────────────────────────────────────

const layer_visibility = [true, true, true];   // visibility state per layer

function update_layer_z_order() {
    draw_layers.forEach((layer, index) => {
        const visible           = layer_visibility[index];
        layer.style.display     = visible ? 'block' : 'none';
        layer.style.zIndex      = index === active_layer ? 3 : 2;
        layer.style.outline     = index === active_layer ? '2px solid rgba(244, 162, 97, 0.4)' : 'none';
        // Sync eye button appearance if it exists
        const eye_btn = document.querySelector(`.layer-eye-button[data-layer="${ index }"]`);
        if (eye_btn) {
            eye_btn.textContent = visible ? '👁' : '🚫';
            eye_btn.title       = visible ? 'Hide layer' : 'Show layer';
            eye_btn.classList.toggle('inactive', !visible);
        }
    });
    // Refresh images so hidden-layer images disappear too
    redraw_all_images_with_layer_visibility();
}

function redraw_all_images_with_layer_visibility() {
    const cw = image_canvas.width;
    const ch = image_canvas.height;
    image_context.clearRect(0, 0, cw, ch);
    image_context.fillStyle = '#faf8f2';
    image_context.fillRect(0, 0, cw, ch);
    for (const image_object of image_list) {
        if (!image_object.is_visible) continue;
        if (!layer_visibility[image_object.layer]) continue;
        image_context.drawImage(image_object.offscreen_canvas, 0, 0);
    }
}

document.querySelectorAll('.layer-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        save_undo();
        document.querySelectorAll('.layer-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        active_layer = parseInt(tab.dataset.layer);
        document.getElementById('activeLayerLabel').textContent = `Layer ${ active_layer + 1 }`;
        update_layer_z_order();
        // Deselect active image if it doesn't belong to the new layer.
        const current_image = image_list.find(item => item.id === active_image_id);
        if (current_image && current_image.layer !== active_layer) {
            active_image_id = null;
            document.getElementById('image-detail').classList.add('hidden');
        }
        render_image_list();
    });
});

document.querySelectorAll('.layer-eye-button').forEach(btn => {
    btn.addEventListener('click', event => {
        event.stopPropagation();
        const index                = parseInt(btn.dataset.layer);
        layer_visibility[index]    = !layer_visibility[index];
        update_layer_z_order();
    });
});

update_layer_z_order();

// ── QUICK COLOR PALETTE ──────────────────────────────────────────────────────

const quick_palette_colors = [
    '#1a1a2e', '#16213e', '#0f3460', '#533483', '#e94560',
    '#f4a261', '#e76f51', '#2a9d8f', '#264653', '#e9c46a',
    '#ffffff',  '#000000', '#ff595e', '#6a4c93', '#1982c4',
    '#8ac926',  '#ffca3a', '#6a6a6a', '#d4a5a5', '#b5838d',
];

const palette_element = document.getElementById('quickPalette');
quick_palette_colors.forEach(hex_color => {
    const dot             = document.createElement('div');
    dot.className = 'palette-color-dot';
    dot.style.background  = hex_color;
    dot.addEventListener('click', () => {
        stroke_color = hex_color;
        update_color_swatches();
    });
    palette_element.appendChild(dot);
});

// ── AUDIO ────────────────────────────────────────────────────────────────────

const AudioContext_constructor = window.AudioContext || window.webkitAudioContext;
let audio_context;

function get_audio_context() {
    if (!audio_context) audio_context = new AudioContext_constructor();
    return audio_context;
}

function play_draw_sound(frequency = 200 + Math.random() * 200, duration = 0.06) {
    if (!draw_sound_on) return;
    try {
        const context     = get_audio_context();
        const oscillator  = context.createOscillator();
        const gain_node   = context.createGain();
        oscillator.connect(gain_node);
        gain_node.connect(context.destination);
        oscillator.type   = 'sine';
        oscillator.frequency.setValueAtTime(frequency, context.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.5, context.currentTime + duration);
        gain_node.gain.setValueAtTime(0.04, context.currentTime);
        gain_node.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
        oscillator.start(context.currentTime);
        oscillator.stop(context.currentTime + duration);
    } catch (error) {}
}

const background_music = document.getElementById('bgMusic');

document.getElementById('musicBtn').addEventListener('click', function () {
    music_on = !music_on;
    if (music_on) {
        background_music.play().catch(() => {});
        this.classList.add('active');
    } else {
        background_music.pause();
        this.classList.remove('active');
    }
});

document.getElementById('soundBtn').addEventListener('click', function () {
    draw_sound_on = !draw_sound_on;
    this.textContent = draw_sound_on ? '🔊' : '🔇';
    this.classList.toggle('active', draw_sound_on);
});

// ── CUSTOM COLOR PICKER ──────────────────────────────────────────────────────

const color_picker_popup    = document.getElementById('color-picker-popup');
const color_picker_title    = document.getElementById('cpTitle');
const color_picker_close    = document.getElementById('cpClose');
const gradient_box          = document.getElementById('cpGradBox');
const gradient_canvas       = document.getElementById('cpGradCanvas');
const gradient_thumb        = document.getElementById('cpGradThumb');
const hue_bar_canvas        = document.getElementById('cpHueBar');
const hue_bar_thumb         = document.getElementById('cpHueThumb');
const alpha_bar_canvas      = document.getElementById('cpAlphaBar');
const alpha_bar_thumb       = document.getElementById('cpAlphaThumb');
const color_preview_box     = document.getElementById('cpPreview');
const hex_input             = document.getElementById('cpHex');
const apply_color_button    = document.getElementById('cpApply');
const stroke_swatch         = document.getElementById('strokeSwatch');
const fill_swatch           = document.getElementById('fillSwatch');

let picker_target    = 'stroke';   // 'stroke' | 'fill'
let picker_hue       = 0;
let picker_saturation = 1;
let picker_lightness  = 0.5;
let picker_alpha     = 1;
let picker_dragging  = null;       // 'gradient' | 'hue' | 'alpha'

function hsl_to_hex(hue, saturation, lightness) {
    const chroma       = saturation * Math.min(lightness, 1 - lightness);
    const channel      = channel_index => {
        const k         = (channel_index + hue / 30) % 12;
        const value     = lightness - chroma * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * value).toString(16).padStart(2, '0');
    };
    return `#${ channel(0) }${ channel(8) }${ channel(4) }`;
}

function hex_to_hsl(hex) {
    let red    = parseInt(hex.slice(1, 3), 16) / 255;
    let green  = parseInt(hex.slice(3, 5), 16) / 255;
    let blue   = parseInt(hex.slice(5, 7), 16) / 255;
    const max  = Math.max(red, green, blue);
    const min  = Math.min(red, green, blue);
    let hue, saturation;
    let lightness = (max + min) / 2;
    if (max === min) {
        hue = saturation = 0;
    } else {
        const delta  = max - min;
        saturation   = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
        switch (max) {
            case red:   hue = ((green - blue)  / delta + (green < blue ? 6 : 0)) / 6; break;
            case green: hue = ((blue  - red)   / delta + 2) / 6; break;
            case blue:  hue = ((red   - green) / delta + 4) / 6; break;
        }
    }
    return { hue: hue * 360, saturation, lightness };
}

function hsl_to_hsv(hue, saturation, lightness) {
    const value            = lightness + saturation * Math.min(lightness, 1 - lightness);
    const saturation_value = value === 0 ? 0 : 2 * (1 - lightness / value);
    return { hue, saturation: saturation_value, value };
}

function hsv_to_hsl(hue, saturation, value) {
    const lightness           = value * (1 - saturation / 2);
    const saturation_lightness = (lightness === 0 || lightness === 1)
        ? 0
        : (value - lightness) / Math.min(lightness, 1 - lightness);
    return { hue, saturation: saturation_lightness, lightness };
}

function draw_gradient_box() {
    const context     = gradient_canvas.getContext('2d');
    const width       = gradient_canvas.width;
    const height      = gradient_canvas.height;
    context.fillStyle = `hsl(${ picker_hue }, 100%, 50%)`;
    context.fillRect(0, 0, width, height);
    const white_gradient = context.createLinearGradient(0, 0, width, 0);
    white_gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    white_gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = white_gradient;
    context.fillRect(0, 0, width, height);
    const black_gradient = context.createLinearGradient(0, height, 0, 0);
    black_gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    black_gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = black_gradient;
    context.fillRect(0, 0, width, height);
}

function draw_hue_bar() {
    const context  = hue_bar_canvas.getContext('2d');
    const width    = hue_bar_canvas.width;
    const height   = hue_bar_canvas.height;
    const gradient = context.createLinearGradient(0, 0, width, 0);
    for (let hue = 0; hue <= 360; hue += 30) {
        gradient.addColorStop(hue / 360, `hsl(${ hue }, 100%, 50%)`);
    }
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
}

function draw_alpha_bar() {
    const context  = alpha_bar_canvas.getContext('2d');
    const width    = alpha_bar_canvas.width;
    const height   = alpha_bar_canvas.height;
    context.clearRect(0, 0, width, height);
    const hex      = hsl_to_hex(picker_hue, picker_saturation, picker_lightness);
    const gradient = context.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, hex + '00');
    gradient.addColorStop(1, hex + 'ff');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
}

function update_thumb_positions() {
    const hsv          = hsl_to_hsv(picker_hue, picker_saturation, picker_lightness);
    const gradient_w   = gradient_canvas.width;
    const gradient_h   = gradient_canvas.height;
    gradient_thumb.style.left = hsv.saturation * gradient_w + 'px';
    gradient_thumb.style.top  = (1 - hsv.value) * gradient_h + 'px';
    hue_bar_thumb.style.left  = (picker_hue / 360) * hue_bar_canvas.width + 'px';
    hue_bar_thumb.style.top   = '9px';
    alpha_bar_thumb.style.left = picker_alpha * alpha_bar_canvas.width + 'px';
    alpha_bar_thumb.style.top  = '9px';
}

function update_color_preview() {
    const hex          = hsl_to_hex(picker_hue, picker_saturation, picker_lightness);
    const alpha_hex    = Math.round(picker_alpha * 255).toString(16).padStart(2, '0');
    hex_input.value    = hex.toUpperCase();
    color_preview_box.style.background =
        `linear-gradient(${ hex }${ alpha_hex }, ${ hex }${ alpha_hex }),
         repeating-conic-gradient(#aaa 0% 25%, #fff 0% 50%) 0 0 / 8px 8px`;
    gradient_thumb.style.background = hex;
}

function refresh_color_picker() {
    draw_gradient_box();
    draw_hue_bar();
    draw_alpha_bar();
    update_thumb_positions();
    update_color_preview();
}

function open_color_picker(target) {
    picker_target = target;
    color_picker_title.textContent = target === 'stroke' ? 'Stroke Color' : 'Fill Color';
    const current_hex              = target === 'stroke' ? stroke_color : fill_color;
    const { hue, saturation, lightness } = hex_to_hsl(current_hex);
    picker_hue         = hue;
    picker_saturation  = saturation;
    picker_lightness   = lightness;
    picker_alpha       = 1;
    refresh_color_picker();

    const swatch        = target === 'stroke' ? stroke_swatch : fill_swatch;
    const bounds        = swatch.getBoundingClientRect();
    const popup_width   = 244;
    const popup_height  = 340;
    let left            = bounds.left + bounds.width / 2 - popup_width / 2;
    let top             = bounds.bottom + 8;
    if (left + popup_width  > window.innerWidth)  left = window.innerWidth  - popup_width  - 8;
    if (left < 8)                                  left = 8;
    if (top  + popup_height > window.innerHeight)  top  = bounds.top - popup_height - 8;
    color_picker_popup.style.left = left + 'px';
    color_picker_popup.style.top  = top  + 'px';
    color_picker_popup.classList.remove('hidden');
}

stroke_swatch.addEventListener('click', () => open_color_picker('stroke'));
fill_swatch.addEventListener('click',   () => open_color_picker('fill'));
color_picker_close.addEventListener('click', () => color_picker_popup.classList.add('hidden'));

document.addEventListener('mousedown', event => {
    if (
        !color_picker_popup.classList.contains('hidden') &&
        !color_picker_popup.contains(event.target) &&
        event.target !== stroke_swatch &&
        event.target !== fill_swatch
    ) {
        apply_picker_color();
        color_picker_popup.classList.add('hidden');
    }
});

function apply_picker_color() {
    const hex = hsl_to_hex(picker_hue, picker_saturation, picker_lightness);
    if (picker_target === 'stroke') {
        stroke_color = hex;
    } else {
        fill_color = hex;
    }
    update_color_swatches();
}

apply_color_button.addEventListener('click', () => {
    apply_picker_color();
    color_picker_popup.classList.add('hidden');
});

hex_input.addEventListener('change', event => {
    const value = event.target.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(value)) {
        const { hue, saturation, lightness } = hex_to_hsl(value);
        picker_hue        = hue;
        picker_saturation = saturation;
        picker_lightness  = lightness;
        refresh_color_picker();
    }
});

function update_from_gradient_event(event) {
    const bounds        = gradient_box.getBoundingClientRect();
    const normalized_x  = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const normalized_y  = Math.max(0, Math.min(1, (event.clientY - bounds.top)  / bounds.height));
    const hsv           = hsl_to_hsv(picker_hue, picker_saturation, picker_lightness);
    hsv.saturation      = normalized_x;
    hsv.value           = 1 - normalized_y;
    const hsl           = hsv_to_hsl(picker_hue, hsv.saturation, hsv.value);
    picker_saturation   = hsl.saturation;
    picker_lightness    = hsl.lightness;
    update_thumb_positions();
    update_color_preview();
    draw_alpha_bar();
}

function update_from_hue_event(event) {
    const bounds    = hue_bar_canvas.getBoundingClientRect();
    picker_hue      = Math.max(0, Math.min(360, ((event.clientX - bounds.left) / bounds.width) * 360));
    draw_gradient_box();
    draw_alpha_bar();
    update_thumb_positions();
    update_color_preview();
}

function update_from_alpha_event(event) {
    const bounds    = alpha_bar_canvas.getBoundingClientRect();
    picker_alpha    = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    update_thumb_positions();
    update_color_preview();
}

gradient_box.addEventListener('mousedown', event => {
    picker_dragging = 'gradient';
    update_from_gradient_event(event);
    event.preventDefault();
});
hue_bar_canvas.addEventListener('mousedown', event => {
    picker_dragging = 'hue';
    update_from_hue_event(event);
    event.preventDefault();
});
alpha_bar_canvas.addEventListener('mousedown', event => {
    picker_dragging = 'alpha';
    update_from_alpha_event(event);
    event.preventDefault();
});

document.addEventListener('mousemove', event => {
    if (picker_dragging === 'gradient') update_from_gradient_event(event);
    if (picker_dragging === 'hue')      update_from_hue_event(event);
    if (picker_dragging === 'alpha')    update_from_alpha_event(event);
});
document.addEventListener('mouseup', () => { picker_dragging = null; });

function update_color_swatches() {
    stroke_swatch.style.background = stroke_color;
    fill_swatch.style.background   = fill_color;
}
update_color_swatches();

// ── CONTROLS ─────────────────────────────────────────────────────────────────

document.getElementById('brushSize').addEventListener('input', event => {
    brush_size = parseInt(event.target.value);
    document.getElementById('brushSizeVal').textContent = brush_size + 'px';
});

document.getElementById('opacity').addEventListener('input', event => {
    draw_opacity = parseFloat(event.target.value);
    document.getElementById('opacityVal').textContent = Math.round(draw_opacity * 100) + '%';
});

document.getElementById('fillToggle').addEventListener('change', event => {
    use_fill = event.target.checked;
});

// ── UNDO AND REDO BUTTONS ────────────────────────────────────────────────────

document.getElementById('undoBtn').addEventListener('click', undo);
document.getElementById('redoBtn').addEventListener('click', redo);

function undo() {
    if (!undo_stack.length) return;
    redo_stack.push({ layers: snapshot_layers(), images: snapshot_images() });
    restore_snapshot(undo_stack.pop());
}

function redo() {
    if (!redo_stack.length) return;
    undo_stack.push({ layers: snapshot_layers(), images: snapshot_images() });
    restore_snapshot(redo_stack.pop());
}

// ── DRAWING ENGINE ───────────────────────────────────────────────────────────

function get_active_layer_context() {
    return layer_contexts[active_layer];
}

function apply_style_to_context(context) {
    context.globalAlpha = draw_opacity;
    context.lineJoin    = 'round';
    context.lineWidth   = brush_size;
    context.strokeStyle = stroke_color;
    if (use_fill) context.fillStyle = fill_color;
    if (brush_shape === 'square') {
        context.lineCap = 'square';
    } else if (brush_shape === 'calligraphy') {
        context.lineCap   = 'square';
        context.lineWidth = brush_size * 0.4;
    } else {
        context.lineCap = 'round';
    }
}

// Calligraphy stroke — angled flat nib effect
function draw_calligraphy_stroke(context, x_from, y_from, x_to, y_to) {
    context.save();
    context.translate((x_from + x_to) / 2, (y_from + y_to) / 2);
    context.rotate(Math.PI / 4);   // 45 degree nib angle
    context.scale(1, 4);            // squash vertically to simulate flat nib
    context.lineWidth = brush_size * 0.5;
    context.lineCap   = 'round';
    context.beginPath();
    const delta_x  = x_to - x_from;
    const delta_y  = y_to - y_from;
    const length   = Math.sqrt(delta_x * delta_x + delta_y * delta_y) || 1;
    context.moveTo(-length / 2, 0);
    context.lineTo( length / 2, 0);
    context.stroke();
    context.restore();
}

// Spray paint — scatter random dots inside a circle
function draw_spray_dots(context, x, y) {
    const dot_count  = Math.max(5, brush_size * 1.5);
    const radius     = brush_size * 2;
    context.save();
    context.fillStyle   = stroke_color;
    context.globalAlpha = draw_opacity * 0.15;
    for (let index = 0; index < dot_count; index++) {
        const angle         = Math.random() * Math.PI * 2;
        const distance      = Math.random() * radius;
        const dot_x         = x + Math.cos(angle) * distance;
        const dot_y         = y + Math.sin(angle) * distance;
        const dot_radius    = Math.random() * 1.5 + 0.5;
        context.beginPath();
        context.arc(dot_x, dot_y, dot_radius, 0, Math.PI * 2);
        context.fill();
    }
    context.restore();
}

let is_dragging_image  = false;
let image_drag_start   = null;

preview_canvas.addEventListener('mousedown',  on_pointer_down);
preview_canvas.addEventListener('mousemove',  on_pointer_move);
preview_canvas.addEventListener('mouseup',    on_pointer_up);
preview_canvas.addEventListener('mouseleave', on_pointer_up);
preview_canvas.addEventListener('touchstart', event => { event.preventDefault(); on_pointer_down(event); }, { passive: false });
preview_canvas.addEventListener('touchmove',  event => { event.preventDefault(); on_pointer_move(event); }, { passive: false });
preview_canvas.addEventListener('touchend',   event => { event.preventDefault(); on_pointer_up(event);   }, { passive: false });

function get_event_canvas_position(event) {
    const client_x = event.touches ? event.touches[0].clientX : event.clientX;
    const client_y = event.touches ? event.touches[0].clientY : event.clientY;
    return viewport_to_canvas(client_x, client_y);
}

function on_pointer_down(event) {
    if (space_down || active_tool === 'pan') return;
    const { x, y } = get_event_canvas_position(event);

    if (active_tool === 'text') {
        place_text_input(x, y);
        return;
    }

    if (active_tool === 'select') {
        for (let index = image_list.length - 1; index >= 0; index--) {
            const image_object = image_list[index];
            if (!image_object.is_visible) continue;
            if (image_object.layer !== active_layer) continue;
            const in_bounds =
                x >= image_object.position.x &&
                x <= image_object.position.x + image_object.position.w &&
                y >= image_object.position.y &&
                y <= image_object.position.y + image_object.position.h;
            if (in_bounds) {
                select_image(image_object.id);
                save_undo();
                is_dragging_image = true;
                image_drag_start  = {
                    mouse_x:        x,
                    mouse_y:        y,
                    initial_image_x: image_object.position.x,
                    initial_image_y: image_object.position.y,
                };
                return;
            }
        }
        return;
    }

    save_undo();
    is_drawing = true;
    start_x    = x;
    start_y    = y;
    last_x     = x;
    last_y     = y;
    pencil_path = [{ x, y }];

    if (active_tool === 'pencil') {
        const context = get_active_layer_context();
        apply_style_to_context(context);
        context.beginPath();
        context.moveTo(x, y);
        play_draw_sound();
    }
}

let sound_throttle_time = 0;

function on_pointer_move(event) {
    if (space_down || active_tool === 'pan') return;
    const { x, y } = get_event_canvas_position(event);
    document.getElementById('cursorPos').textContent = `x: ${ Math.round(x) }, y: ${ Math.round(y) }`;

    if (is_dragging_image && image_drag_start) {
        const image_object = get_active_image();
        if (!image_object) return;
        const new_x = image_drag_start.initial_image_x + (x - image_drag_start.mouse_x);
        const new_y = image_drag_start.initial_image_y + (y - image_drag_start.mouse_y);
        move_image_to(image_object, new_x, new_y);
        redraw_all_images();
        document.getElementById('imgX').value = Math.round(new_x);
        document.getElementById('imgY').value = Math.round(new_y);
        return;
    }

    if (!is_drawing) return;

    const now = Date.now();
    if (active_tool === 'pencil' && now - sound_throttle_time > 60) {
        play_draw_sound(150 + Math.random() * 300, 0.04);
        sound_throttle_time = now;
    }

    if (active_tool === 'pencil') {
        const context = get_active_layer_context();
        if (brush_shape === 'spray') {
            draw_spray_dots(context, x, y);
        } else if (brush_shape === 'calligraphy') {
            apply_style_to_context(context);
            draw_calligraphy_stroke(context, last_x, last_y, x, y);
        } else {
            apply_style_to_context(context);
            pencil_path.push({ x, y });
            if (pencil_path.length >= 3) {
                const second_to_last = pencil_path[pencil_path.length - 2];
                const last_point     = pencil_path[pencil_path.length - 1];
                const midpoint_x     = (second_to_last.x + last_point.x) / 2;
                const midpoint_y     = (second_to_last.y + last_point.y) / 2;
                context.quadraticCurveTo(second_to_last.x, second_to_last.y, midpoint_x, midpoint_y);
                context.stroke();
                context.beginPath();
                context.moveTo(midpoint_x, midpoint_y);
            }
        }
        last_x = x;
        last_y = y;
        return;
    }

    if (active_tool === 'eraser') {
        // Erase on each erasable image on the active layer, and also erase the drawing
        // layer only where the eraser stroke overlaps an erasable image.
        const layer_context = get_active_layer_context();
        let   any_erasable_hit = false;

        for (const image_object of image_list) {
            if (!image_object.is_visible || !image_object.is_erasable) continue;
            if (image_object.layer !== active_layer) continue;

            // Check if the eraser stroke bounding area overlaps this image's bounds.
            const eraser_radius = brush_size;
            const stroke_left   = Math.min(last_x, x) - eraser_radius;
            const stroke_right  = Math.max(last_x, x) + eraser_radius;
            const stroke_top    = Math.min(last_y, y) - eraser_radius;
            const stroke_bottom = Math.max(last_y, y) + eraser_radius;
            const img_right     = image_object.position.x + image_object.position.w;
            const img_bottom    = image_object.position.y + image_object.position.h;
            const overlaps      =
                stroke_right  > image_object.position.x &&
                stroke_left   < img_right &&
                stroke_bottom > image_object.position.y &&
                stroke_top    < img_bottom;

            if (overlaps) {
                any_erasable_hit = true;
                // Erase the drawing layer at this stroke.
                layer_context.globalCompositeOperation = 'destination-out';
                layer_context.lineWidth = brush_size * 2;
                layer_context.lineCap   = 'round';
                layer_context.beginPath();
                layer_context.moveTo(last_x, last_y);
                layer_context.lineTo(x, y);
                layer_context.stroke();
                layer_context.globalCompositeOperation = 'source-over';
            }

            // Always erase the image itself (in image-local coords).
            const local_last_x = last_x - image_object.position.x;
            const local_last_y = last_y - image_object.position.y;
            const local_x      = x - image_object.position.x;
            const local_y      = y - image_object.position.y;
            image_object.erase_context.lineWidth   = brush_size * 2;
            image_object.erase_context.lineCap     = 'round';
            image_object.erase_context.strokeStyle = '#000000';
            image_object.erase_context.beginPath();
            image_object.erase_context.moveTo(local_last_x, local_last_y);
            image_object.erase_context.lineTo(local_x, local_y);
            image_object.erase_context.stroke();
            rebuild_offscreen(image_object);
        }

        // If the eraser didn't hit any erasable image, erase the drawing layer normally.
        if (!any_erasable_hit) {
            layer_context.globalCompositeOperation = 'destination-out';
            layer_context.lineWidth = brush_size * 2;
            layer_context.lineCap   = 'round';
            layer_context.beginPath();
            layer_context.moveTo(last_x, last_y);
            layer_context.lineTo(x, y);
            layer_context.stroke();
            layer_context.globalCompositeOperation = 'source-over';
        }

        redraw_all_images();
        last_x = x;
        last_y = y;
        return;
    }

    // Shape preview
    preview_context.clearRect(0, 0, canvas_width, canvas_height);
    preview_context.save();
    apply_style_to_context(preview_context);
    draw_shape(preview_context, active_tool, start_x, start_y, x, y);
    preview_context.restore();
    last_x = x;
    last_y = y;
}

function on_pointer_up(event) {
    if (is_dragging_image) {
        is_dragging_image = false;
        image_drag_start  = null;
        return;
    }
    if (!is_drawing) return;
    is_drawing = false;

    const position = event.touches ? null : get_event_canvas_position(event);
    const x        = position ? position.x : last_x;
    const y        = position ? position.y : last_y;
    const context  = get_active_layer_context();

    preview_context.clearRect(0, 0, canvas_width, canvas_height);

    if (['rect', 'circle', 'line', 'triangle'].includes(active_tool)) {
        apply_style_to_context(context);
        draw_shape(context, active_tool, start_x, start_y, x, y);
        play_draw_sound(300, 0.1);
    }

    context.globalAlpha = 1;
}

function draw_shape(context, tool, x_from, y_from, x_to, y_to) {
    context.beginPath();
    if (tool === 'rect') {
        context.rect(x_from, y_from, x_to - x_from, y_to - y_from);
    } else if (tool === 'circle') {
        const radius_x  = Math.abs(x_to - x_from) / 2;
        const radius_y  = Math.abs(y_to - y_from) / 2;
        const center_x  = x_from + (x_to - x_from) / 2;
        const center_y  = y_from + (y_to - y_from) / 2;
        context.ellipse(center_x, center_y, Math.max(radius_x, 1), Math.max(radius_y, 1), 0, 0, Math.PI * 2);
    } else if (tool === 'line') {
        context.moveTo(x_from, y_from);
        context.lineTo(x_to, y_to);
    } else if (tool === 'triangle') {
        context.moveTo(x_from, y_from);
        context.lineTo(x_to, y_to);
        context.lineTo(x_from - (x_to - x_from), y_to);
        context.closePath();
    }
    if (use_fill && tool !== 'line') context.fill();
    context.stroke();
}

// ── TEXT TOOL ────────────────────────────────────────────────────────────────

let text_canvas_x      = 0;
let text_canvas_y      = 0;
let text_just_placed   = false;

const font_definitions = [
    { label: 'Handwritten', family: "'Caveat', cursive",            google: 'Caveat:wght@700'                },
    { label: 'Serif',       family: "'Playfair Display', serif",    google: 'Playfair+Display:wght@700'      },
    { label: 'Mono',        family: "'DM Mono', monospace",         google: 'DM+Mono:wght@500'               },
    { label: 'Bold Sans',   family: "'Oswald', sans-serif",         google: 'Oswald:wght@700'                },
    { label: 'Elegant',     family: "'Cormorant Garamond', serif",  google: 'Cormorant+Garamond:wght@700'   },
    { label: 'Marker',      family: "'Permanent Marker', cursive",  google: 'Permanent+Marker'              },
];
let active_font_index = 0;

font_definitions.forEach(font => {
    const link   = document.createElement('link');
    link.rel     = 'stylesheet';
    link.href    = `https://fonts.googleapis.com/css2?family=${ font.google }&display=swap`;
    document.head.appendChild(link);
});

const text_overlay  = document.getElementById('text-input-overlay');
const text_input    = document.getElementById('textInput');

const font_selector = document.createElement('div');
font_selector.id = 'font-selector';
font_definitions.forEach((font, index) => {
    const button          = document.createElement('button');
    button.className      = 'font-choice-button' + (index === 0 ? ' active' : '');
    button.textContent    = font.label;
    button.style.fontFamily = font.family;
    button.dataset.index  = index;
    button.addEventListener('mousedown', event => {
        event.stopPropagation();
        document.querySelectorAll('.font-choice-button').forEach(b => b.classList.remove('active'));
        button.classList.add('active');
        active_font_index         = index;
        text_input.style.fontFamily = font.family;
        text_input.focus();
    });
    font_selector.appendChild(button);
});
text_overlay.insertBefore(font_selector, text_input);

function place_text_input(canvas_x, canvas_y) {
    if (!text_overlay.classList.contains('hidden')) commit_text();
    const bounds        = viewport.getBoundingClientRect();
    const screen_x      = bounds.left + pan_x + canvas_x * zoom;
    const screen_y      = bounds.top  + pan_y + canvas_y * zoom;
    const overlay_width  = 260;
    const overlay_height = 140;
    text_overlay.style.left = Math.min(screen_x, window.innerWidth  - overlay_width  - 8) + 'px';
    text_overlay.style.top  = Math.min(screen_y, window.innerHeight - overlay_height - 8) + 'px';
    text_canvas_x = canvas_x;
    text_canvas_y = canvas_y;
    text_overlay.classList.remove('hidden');
    text_input.value              = '';
    text_input.style.color        = stroke_color;
    text_input.style.fontFamily   = font_definitions[active_font_index].family;
    text_input.style.fontSize     = Math.max(14, brush_size * 3) + 'px';
    text_just_placed = true;
    setTimeout(() => { text_just_placed = false; }, 0);
    text_input.focus();
}

text_input.addEventListener('keydown', event => {
    if (event.key === 'Enter')  { event.preventDefault(); commit_text(); }
    if (event.key === 'Escape') text_overlay.classList.add('hidden');
});

document.addEventListener('mousedown', event => {
    if (text_just_placed) return;
    if (!text_overlay.classList.contains('hidden') && !text_overlay.contains(event.target)) {
        commit_text();
    }
});

function commit_text() {
    const text_value = text_input.value.trim();
    if (text_value) {
        save_undo();
        const context      = get_active_layer_context();
        const font_size    = Math.max(14, brush_size * 3);
        context.globalAlpha  = draw_opacity;
        context.fillStyle    = stroke_color;
        context.font         = `${ font_size }px ${ font_definitions[active_font_index].family }`;
        context.textBaseline = 'top';
        context.fillText(text_value, text_canvas_x, text_canvas_y);
        context.globalAlpha  = 1;
        context.textBaseline = 'alphabetic';
        play_draw_sound(500, 0.15);
    }
    text_overlay.classList.add('hidden');
    text_input.value = '';
}

// ── CROP TOOL ────────────────────────────────────────────────────────────────

let crop_is_dragging = false;
let crop_active_handle = null;
let crop_rectangle   = { x: 100, y: 100, w: 300, h: 200 };
const crop_overlay   = document.getElementById('cropOverlay');
const crop_box       = document.getElementById('cropBox');

document.getElementById('cropBtn').addEventListener('click', () => {
    const image_object = get_active_image();
    if (!image_object) return;
    crop_rectangle = {
        x: image_object.position.x,
        y: image_object.position.y,
        w: image_object.position.w,
        h: image_object.position.h,
    };
    update_crop_box_position();
    crop_overlay.classList.remove('hidden');
});

function update_crop_box_position() {
    const bounds     = viewport.getBoundingClientRect();
    const screen_x   = bounds.left + pan_x + crop_rectangle.x * zoom;
    const screen_y   = bounds.top  + pan_y + crop_rectangle.y * zoom;
    crop_box.style.left   = screen_x + 'px';
    crop_box.style.top    = screen_y + 'px';
    crop_box.style.width  = crop_rectangle.w * zoom + 'px';
    crop_box.style.height = crop_rectangle.h * zoom + 'px';
}

crop_box.addEventListener('mousedown', event => {
    if (event.target.classList.contains('crop-handle')) {
        crop_active_handle = event.target.className.replace('crop-handle ', '').trim();
    } else {
        crop_is_dragging = true;
    }
    event.stopPropagation();
});

document.addEventListener('mousemove', event => {
    if (crop_overlay.classList.contains('hidden')) return;
    const delta_x = event.movementX / zoom;
    const delta_y = event.movementY / zoom;
    if (crop_is_dragging) {
        crop_rectangle.x += delta_x;
        crop_rectangle.y += delta_y;
        update_crop_box_position();
    } else if (crop_active_handle) {
        if (crop_active_handle.includes('e')) crop_rectangle.w = Math.max(20, crop_rectangle.w + delta_x);
        if (crop_active_handle.includes('s')) crop_rectangle.h = Math.max(20, crop_rectangle.h + delta_y);
        if (crop_active_handle.includes('w')) {
            crop_rectangle.x += delta_x;
            crop_rectangle.w  = Math.max(20, crop_rectangle.w - delta_x);
        }
        if (crop_active_handle.includes('n')) {
            crop_rectangle.y += delta_y;
            crop_rectangle.h  = Math.max(20, crop_rectangle.h - delta_y);
        }
        update_crop_box_position();
    }
});

document.addEventListener('mouseup', () => {
    crop_is_dragging   = false;
    crop_active_handle = null;
});

document.getElementById('confirmCrop').addEventListener('click', () => {
    const image_object = get_active_image();
    if (!image_object) { crop_overlay.classList.add('hidden'); return; }
    save_undo();

    const scale_x      = image_object.source_element.width  / image_object.position.w;
    const scale_y      = image_object.source_element.height / image_object.position.h;
    const source_x     = (crop_rectangle.x - image_object.position.x) * scale_x;
    const source_y     = (crop_rectangle.y - image_object.position.y) * scale_y;
    const source_width  = crop_rectangle.w * scale_x;
    const source_height = crop_rectangle.h * scale_y;

    const temp_canvas   = document.createElement('canvas');
    temp_canvas.width   = Math.max(1, source_width);
    temp_canvas.height  = Math.max(1, source_height);
    temp_canvas.getContext('2d').drawImage(
        image_object.source_element,
        source_x, source_y, source_width, source_height,
        0, 0, source_width, source_height
    );

    const cropped_data_url = temp_canvas.toDataURL();
    const cropped_element  = new Image();
    cropped_element.onload = () => {
        image_object.source_element  = cropped_element;
        image_object.source_data_url = cropped_data_url;
        image_object.position.x      = crop_rectangle.x;
        image_object.position.y      = crop_rectangle.y;
        image_object.position.w      = crop_rectangle.w;
        image_object.position.h      = crop_rectangle.h;
        // Reset erase mask to match new image dimensions.
        image_object.erase_canvas.width  = crop_rectangle.w;
        image_object.erase_canvas.height = crop_rectangle.h;
        image_object.erase_context.clearRect(0, 0, crop_rectangle.w, crop_rectangle.h);
        rebuild_offscreen(image_object);
        redraw_all_images();
        render_image_list();
        select_image(image_object.id);
    };
    cropped_element.src = cropped_data_url;
    crop_overlay.classList.add('hidden');
});

document.getElementById('cancelCrop').addEventListener('click', () => {
    crop_overlay.classList.add('hidden');
});

// ── DOWNLOAD ─────────────────────────────────────────────────────────────────

document.getElementById('downloadBtn').addEventListener('click', () => {
    const output_canvas   = document.createElement('canvas');
    output_canvas.width   = canvas_width;
    output_canvas.height  = canvas_height;
    const output_context  = output_canvas.getContext('2d');
    output_context.fillStyle = '#faf8f2';
    output_context.fillRect(0, 0, canvas_width, canvas_height);
    output_context.drawImage(image_canvas, 0, 0);
    draw_layers.forEach((layer, index) => {
        if (layer_visibility[index]) output_context.drawImage(layer, 0, 0);
    });
    const download_link       = document.createElement('a');
    download_link.download    = 'wad-canvas-' + Date.now() + '.png';
    download_link.href        = output_canvas.toDataURL('image/png');
    download_link.click();
    play_draw_sound(600, 0.2);
});

// ── BRUSH SHAPES ─────────────────────────────────────────────────────────────

document.querySelectorAll('.brush-shape-button').forEach(button => {
    button.addEventListener('click', () => {
        document.querySelectorAll('.brush-shape-button').forEach(b => b.classList.remove('active'));
        button.classList.add('active');
        brush_shape = button.dataset.shape;
    });
});

// ── REFRESH LAYER ─────────────────────────────────────────────────────────────

document.querySelectorAll('.layer-clear-button').forEach(span => {
    span.addEventListener('click', event => {
        event.stopPropagation();
        const layer_index = parseInt(span.dataset.layer);
        if (!confirm(`Clear Layer ${ layer_index + 1 }?`)) return;
        save_undo();
        layer_contexts[layer_index].clearRect(
            0, 0,
            draw_layers[layer_index].width,
            draw_layers[layer_index].height
        );
        // Remove only images that belong to this layer.
        const removed_ids = new Set(
            image_list.filter(img => img.layer === layer_index).map(img => img.id)
        );
        if (removed_ids.size > 0) {
            image_list = image_list.filter(img => img.layer !== layer_index);
            if (removed_ids.has(active_image_id)) {
                active_image_id = null;
                document.getElementById('image-detail').classList.add('hidden');
            }
            if (image_list.length === 0) document.getElementById('image-panel').classList.add('hidden');
            redraw_all_images();
            render_image_list();
        }
    });
});

// ── CANVAS SIZE ───────────────────────────────────────────────────────────────

let current_canvas_width  = canvas_width;
let current_canvas_height = canvas_height;

document.getElementById('canvasSizeBtn').addEventListener('click', () => {
    document.getElementById('canvasWInput').value = current_canvas_width;
    document.getElementById('canvasHInput').value = current_canvas_height;
    document.getElementById('canvas-size-modal').classList.remove('hidden');
});

document.getElementById('canvasSizeClose').addEventListener('click', () => {
    document.getElementById('canvas-size-modal').classList.add('hidden');
});

document.getElementById('canvasSizeCancel').addEventListener('click', () => {
    document.getElementById('canvas-size-modal').classList.add('hidden');
});

document.querySelectorAll('.preset-button').forEach(button => {
    button.addEventListener('click', () => {
        document.getElementById('canvasWInput').value = button.dataset.w;
        document.getElementById('canvasHInput').value = button.dataset.h;
    });
});

document.getElementById('canvasSizeApply').addEventListener('click', () => {
    const new_width  = parseInt(document.getElementById('canvasWInput').value) || current_canvas_width;
    const new_height = parseInt(document.getElementById('canvasHInput').value) || current_canvas_height;
    if (new_width < 100 || new_height < 100 || new_width > 8000 || new_height > 8000) {
        alert('Size must be between 100 and 8000 pixels.');
        return;
    }
    resize_canvas(new_width, new_height);
    document.getElementById('canvas-size-modal').classList.add('hidden');
});

function resize_canvas(new_width, new_height) {
    current_canvas_width  = new_width;
    current_canvas_height = new_height;

    [image_canvas, draw_layer_0, draw_layer_1, draw_layer_2, preview_canvas].forEach(canvas => {
        canvas.width  = new_width;
        canvas.height = new_height;
    });

    canvas_wrapper.style.width  = new_width  + 'px';
    canvas_wrapper.style.height = new_height + 'px';

    draw_paper_texture_sized(new_width, new_height);

    image_list.forEach(image_object => {
        // Only the offscreen canvas needs to match the canvas size.
        // erase_canvas is image-sized and never needs resizing.
        const temp_off   = document.createElement('canvas');
        temp_off.width   = new_width;
        temp_off.height  = new_height;
        temp_off.getContext('2d').drawImage(image_object.offscreen_canvas, 0, 0);
        image_object.offscreen_canvas.width  = new_width;
        image_object.offscreen_canvas.height = new_height;
        // Rebuild properly from source + erase mask at new canvas size.
        rebuild_offscreen(image_object);
    });

    redraw_all_images();
    undo_stack.length = 0;
    redo_stack.length = 0;
    fit_canvas_to_screen();
}

// ── PAPER TEXTURE ────────────────────────────────────────────────────────────

function draw_paper_texture_sized(width, height) {
    image_context.fillStyle = '#faf8f2';
    image_context.fillRect(0, 0, width, height);
    for (let index = 0; index < 5000; index++) {
        image_context.globalAlpha = Math.random() * 0.035;
        image_context.fillStyle   = Math.random() > 0.5 ? '#c8b8a2' : '#e8dcc8';
        image_context.fillRect(
            Math.random() * width,
            Math.random() * height,
            Math.random() * 3 + 0.5,
            Math.random() * 3 + 0.5
        );
    }
    image_context.globalAlpha = 1;
}

function draw_paper_texture() {
    draw_paper_texture_sized(canvas_width, canvas_height);
}

console.log('%c WEB Canvas Ready 🖌️', 'font-size: 16px; color: #f4a261');
