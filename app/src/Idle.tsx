import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { usePauseBackdrops } from './Backdrop';

const AFTER_MS = 5 * 60 * 1000;

/**
 * Helm keeps the iPad awake, so after a few untouched minutes it dims to a quiet clock.
 * The first tap only wakes it (it never presses the key underneath).
 * Call the returned `touched` on every touch (App does it from the root's responder capture).
 */
export function useIdle() {
  const [idle, setIdle] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const touched = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setIdle(true), AFTER_MS);
  };
  useEffect(() => {
    touched();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);
  return { idle, touched, wake: () => { setIdle(false); touched(); } };
}

export function IdleScreen({ onWake }: { onWake: () => void }) {
  usePauseBackdrops();
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  return (
    <Animated.View entering={FadeIn.duration(1200)} exiting={FadeOut.duration(250)} style={StyleSheet.absoluteFill}>
      <Pressable style={st.root} onPress={onWake} accessibilityLabel="Wake Helm">
        <Text style={st.time}>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
        <Text style={st.hint}>Tap to wake</Text>
      </Pressable>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  time: { color: '#6b7078', fontSize: 120, fontWeight: '100', fontVariant: ['tabular-nums'] },
  hint: { color: '#3d4148', fontSize: 15, marginTop: 8, letterSpacing: 1 },
});
