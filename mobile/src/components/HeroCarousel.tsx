import { useRef, useState } from 'react';
import { Dimensions, FlatList, Image, StyleSheet, View, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { colors } from '@/theme/colors';

interface HeroCarouselProps {
  // Optional accent override; defaults to the gold palette.
  theme?: { accent: string; border: string };
}

const SCREEN_WIDTH = Dimensions.get('window').width;
const SLIDE_WIDTH = SCREEN_WIDTH - 40; // matches the 20px screen gutters used elsewhere on this screen
const SLIDE_HEIGHT = 180;
const SLIDE_SPACING = 20; // left gutter of the next slide peeking in, snapped to below

// Order shown in the carousel. hero-5 (the green-bed bedroom) leads - founder's choice 2026-10-08.
const HERO_IMAGES = [
  require('../../assets/hero/hero-5.jpg'),
  require('../../assets/hero/hero-1.jpg'),
  require('../../assets/hero/hero-2.jpg'),
  require('../../assets/hero/hero-3.jpg'),
  require('../../assets/hero/hero-4.jpg'),
];

export default function HeroCarousel({ theme }: HeroCarouselProps) {
  const accent = theme?.accent ?? colors.gold;
  const inactive = theme?.border ?? colors.border;
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<FlatList>(null);

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / (SLIDE_WIDTH + SLIDE_SPACING));
    if (index !== activeIndex && index >= 0 && index < HERO_IMAGES.length) {
      setActiveIndex(index);
    }
  }

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={HERO_IMAGES}
        keyExtractor={(_, index) => `hero-${index}`}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={SLIDE_WIDTH + SLIDE_SPACING}
        decelerationRate="fast"
        contentContainerStyle={styles.listContent}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        renderItem={({ item }) => (
          <Image source={item} style={styles.slide} resizeMode="cover" />
        )}
      />
      <View style={styles.dots}>
        {HERO_IMAGES.map((_, index) => (
          <View
            key={`dot-${index}`}
            style={[
              styles.dot,
              { backgroundColor: inactive },
              index === activeIndex && [styles.dotActive, { backgroundColor: accent }],
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 14,
  },
  listContent: {
    paddingHorizontal: 20,
  },
  slide: {
    width: SLIDE_WIDTH,
    height: SLIDE_HEIGHT,
    borderRadius: 14,
    marginRight: SLIDE_SPACING,
    backgroundColor: colors.border,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 10,
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.gold,
    width: 16,
  },
});
