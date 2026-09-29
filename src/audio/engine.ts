import * as THREE from 'three';
import { generateSfx, generateBed, AudioType } from './synth';

export type Biome = 'highlands' | 'jungle' | 'cave' | 'river';
export type Intensity = 'calm' | 'explore' | 'tension';

export interface PlayOptions {
    position?: THREE.Vector3;
    volume?: number;
    loop?: boolean;
}

export class AudioDirector {
    private ctx: AudioContext;
    private masterGain: GainNode;
    private compressor: DynamicsCompressorNode;

    // Adaptive music state
    private currentBiome: Biome = 'highlands';
    private currentIntensity: Intensity = 'calm';

    // Music layers
    private musicLayers: Map<Intensity, { gain: GainNode, source: AudioBufferSourceNode | null }> = new Map();
    private activeMusicNodes: AudioBufferSourceNode[] = [];

    // Cache for generated SFX buffers
    private sfxCache: Map<AudioType, AudioBuffer> = new Map();

    constructor(_camera: THREE.Camera) {
        this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

        // Setup Master Bus
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.8;

        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -12;
        this.compressor.knee.value = 40;
        this.compressor.ratio.value = 12;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.25;

        this.masterGain.connect(this.compressor);
        this.compressor.connect(this.ctx.destination);

        this.setupMusicLayers();
    }

    public resume() {
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    private setupMusicLayers() {
        const intensities: Intensity[] = ['calm', 'explore', 'tension'];

        intensities.forEach(intensity => {
            const gainNode = this.ctx.createGain();
            gainNode.gain.value = 0; // All muted initially
            gainNode.connect(this.masterGain);
            this.musicLayers.set(intensity, { gain: gainNode, source: null });
        });
    }

    public async play(name: AudioType, options: PlayOptions = {}): Promise<void> {
        this.resume();

        let buffer = this.sfxCache.get(name);
        if (!buffer) {
            const newBuffer = await generateSfx(this.ctx, name);
            if (!newBuffer) return;
            buffer = newBuffer;
            this.sfxCache.set(name, buffer);
        }

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = options.loop || false;

        let outputNode: AudioNode = source;

        // Apply 3D positioning if position is provided
        if (options.position) {
            const panner = this.ctx.createPanner();
            panner.panningModel = 'HRTF';
            panner.distanceModel = 'inverse';
            panner.refDistance = 1;
            panner.maxDistance = 10000;
            panner.rolloffFactor = 1;

            panner.positionX.value = options.position.x;
            panner.positionY.value = options.position.y;
            panner.positionZ.value = options.position.z;

            source.connect(panner);
            outputNode = panner;
        }

        // Apply specific volume
        const gainNode = this.ctx.createGain();
        gainNode.gain.value = options.volume !== undefined ? options.volume : 1.0;
        outputNode.connect(gainNode);

        gainNode.connect(this.masterGain);

        source.start();
    }

    public setBiome(biome: Biome) {
        if (this.currentBiome === biome) return;
        this.currentBiome = biome;
        this.updateMusicLayers();
    }

    public setIntensity(intensity: Intensity) {
        if (this.currentIntensity === intensity) return;
        this.currentIntensity = intensity;
        this.crossfadeIntensity(intensity);
    }

    private crossfadeIntensity(targetIntensity: Intensity) {
        const fadeTime = 2.0; // 2 seconds crossfade
        const now = this.ctx.currentTime;

        this.musicLayers.forEach((layer, intensity) => {
            layer.gain.gain.cancelScheduledValues(now);
            if (intensity === targetIntensity) {
                layer.gain.gain.linearRampToValueAtTime(1.0, now + fadeTime);
            } else {
                layer.gain.gain.linearRampToValueAtTime(0.0, now + fadeTime);
            }
        });
    }

    private async updateMusicLayers() {
        this.resume();

        // Stop previous layers
        this.activeMusicNodes.forEach(node => {
            try { node.stop(); node.disconnect(); } catch(e) {}
        });
        this.activeMusicNodes = [];

        const intensities: Intensity[] = ['calm', 'explore', 'tension'];

        // Generate beds concurrently
        const buffers = await Promise.all(
            intensities.map(intensity => generateBed(this.ctx, this.currentBiome, intensity))
        );

        const startTime = this.ctx.currentTime + 0.1;

        intensities.forEach((intensity, index) => {
            const buffer = buffers[index];
            if (buffer) {
                const source = this.ctx.createBufferSource();
                source.buffer = buffer;
                source.loop = true;

                const layer = this.musicLayers.get(intensity);
                if (layer) {
                    source.connect(layer.gain);
                    layer.source = source;
                    this.activeMusicNodes.push(source);
                    source.start(startTime);
                }
            }
        });

        // Ensure only the current intensity is audible
        this.crossfadeIntensity(this.currentIntensity);
    }

    public update(camera: THREE.Camera) {
        // Sync AudioListener position with THREE Camera if context allows it
        if (this.ctx.listener && this.ctx.listener.positionX) {
            const pos = camera.position;

            // Web Audio API standard (requires setting values on AudioParam)
            this.ctx.listener.positionX.setTargetAtTime(pos.x, this.ctx.currentTime, 0.01);
            this.ctx.listener.positionY.setTargetAtTime(pos.y, this.ctx.currentTime, 0.01);
            this.ctx.listener.positionZ.setTargetAtTime(pos.z, this.ctx.currentTime, 0.01);

            // Forward vector
            const dir = new THREE.Vector3();
            camera.getWorldDirection(dir);
            this.ctx.listener.forwardX.setTargetAtTime(dir.x, this.ctx.currentTime, 0.01);
            this.ctx.listener.forwardY.setTargetAtTime(dir.y, this.ctx.currentTime, 0.01);
            this.ctx.listener.forwardZ.setTargetAtTime(dir.z, this.ctx.currentTime, 0.01);

            // Up vector
            const up = camera.up;
            this.ctx.listener.upX.setTargetAtTime(up.x, this.ctx.currentTime, 0.01);
            this.ctx.listener.upY.setTargetAtTime(up.y, this.ctx.currentTime, 0.01);
            this.ctx.listener.upZ.setTargetAtTime(up.z, this.ctx.currentTime, 0.01);
        } else {
            // Deprecated fallback
            const pos = camera.position;
            const dir = new THREE.Vector3();
            camera.getWorldDirection(dir);
            const up = camera.up;

            if (this.ctx.listener.setPosition) {
                this.ctx.listener.setPosition(pos.x, pos.y, pos.z);
                this.ctx.listener.setOrientation(dir.x, dir.y, dir.z, up.x, up.y, up.z);
            }
        }
    }
}
