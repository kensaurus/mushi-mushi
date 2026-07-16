'use client'

/**
 * Ambient ink/moth wash behind the landing hero.
 * Procedural meshes only — no GLTF. Brand palette (paper / sumi / vermillion).
 * Desktop-only (parent gates mount); reduced-motion uses `frameloop="never"`.
 *
 * Timebase: THREE.Timer (not Clock). R3F v9 still constructs THREE.Clock
 * internally (pmndrs/react-three-fiber#3741) — silenced via the official
 * `THREE.setConsoleFunction` API until R3F v10 ships stable.
 */
import { useRef, useMemo, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

const CLOCK_DEPRECATION = 'Clock: This module has been deprecated'

/**
 * Prefer three's setConsoleFunction over monkey-patching console.warn
 * (matches the approach used by other r183+ apps awaiting R3F v10).
 */
function muteR3fClockDeprecation(): () => void {
  const previous = THREE.getConsoleFunction?.() ?? null
  THREE.setConsoleFunction((type, message, ...params) => {
    if (
      type === 'warn' &&
      typeof message === 'string' &&
      message.includes(CLOCK_DEPRECATION)
    ) {
      return
    }
    if (previous) {
      previous(type, message, ...params)
      return
    }
    if (type === 'error') console.error(message, ...params)
    else if (type === 'warn') console.warn(message, ...params)
    else console.log(message, ...params)
  })
  return () => {
    THREE.setConsoleFunction(previous)
  }
}

/** Force WebGL teardown on route leave so Context Lost is intentional, not a leak. */
function CanvasDisposer() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    return () => {
      gl.dispose()
    }
  }, [gl])
  return null
}

function InkBlots({ reduced }: { reduced: boolean }) {
  const group = useRef<THREE.Group>(null)
  const timer = useMemo(() => new THREE.Timer(), [])

  const materials = useMemo(
    () => ({
      ink: new THREE.MeshBasicMaterial({
        color: new THREE.Color('#0e0d0b'),
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
      }),
      vermillion: new THREE.MeshBasicMaterial({
        color: new THREE.Color('#e03c2c'),
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      }),
      wash: new THREE.MeshBasicMaterial({
        color: new THREE.Color('#5c5852'),
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
      }),
    }),
    [],
  )

  const geometries = useMemo(
    () => ({
      large: new THREE.CircleGeometry(1, 48),
      small: new THREE.CircleGeometry(1, 32),
    }),
    [],
  )

  useEffect(() => {
    timer.connect(document)
    return () => {
      timer.dispose()
      materials.ink.dispose()
      materials.vermillion.dispose()
      materials.wash.dispose()
      geometries.large.dispose()
      geometries.small.dispose()
    }
  }, [materials, geometries, timer])

  useFrame(() => {
    if (reduced || !group.current) return
    timer.update()
    const t = timer.getElapsed()
    group.current.rotation.z = Math.sin(t * 0.12) * 0.04
    group.current.children.forEach((child, i) => {
      child.position.y = Math.sin(t * 0.25 + i) * 0.08
      child.rotation.z = t * (0.05 + i * 0.01)
    })
  })

  // Soft elliptical "moth wing" / ink blot discs — weighted toward the right
  // so the hero's open side reads as intentional sumi atmosphere, not blank.
  return (
    <group ref={group}>
      <mesh
        position={[1.9, 0.5, -0.3]}
        scale={[2.2, 1.3, 1]}
        material={materials.ink}
        geometry={geometries.large}
      />
      <mesh
        position={[2.6, -0.6, -0.2]}
        scale={[1.5, 1.0, 1]}
        material={materials.wash}
        geometry={geometries.large}
      />
      <mesh
        position={[1.4, 1.0, 0.1]}
        scale={[0.7, 0.7, 1]}
        material={materials.vermillion}
        geometry={geometries.small}
      />
      <mesh
        position={[3.1, 0.8, 0]}
        scale={[0.9, 0.4, 1]}
        rotation={[0, 0, 0.5]}
        material={materials.ink}
        geometry={geometries.large}
      />
      <mesh
        position={[2.0, -1.3, 0.1]}
        scale={[0.4, 0.4, 1]}
        material={materials.vermillion}
        geometry={geometries.small}
      />
      <mesh
        position={[-1.6, -0.4, -0.4]}
        scale={[1.3, 0.7, 1]}
        material={materials.wash}
        geometry={geometries.large}
      />
    </group>
  )
}

export interface InkMothCanvasProps {
  reducedMotion?: boolean
}

export function InkMothCanvas({ reducedMotion = false }: InkMothCanvasProps) {
  useEffect(() => muteR3fClockDeprecation(), [])

  return (
    <div className="landing-ink-canvas" aria-hidden="true">
      <Canvas
        orthographic
        camera={{ zoom: 80, position: [0, 0, 10] }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
        frameloop={reducedMotion ? 'never' : 'always'}
        style={{ width: '100%', height: '100%' }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0)
        }}
      >
        <CanvasDisposer />
        <InkBlots reduced={reducedMotion} />
      </Canvas>
    </div>
  )
}
