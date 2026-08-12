package protocol

import (
	"encoding/binary"
	"math"
	"testing"

	"rocket-vibe/internal/game"
)

func TestStatePacketMatchesBrowserLayout(t *testing.T) {
	snapshot := game.Snapshot{Tick: 0x11223344, ConnectedMask: 0x05, GroundMask: 0x01, OrangeScore: 7, BlueScore: 9}
	snapshot.Cars[0] = game.EntityState{
		Position: game.Vec3{X: 1.25, Y: -2.5, Z: 3.75},
		Rotation: game.IdentityQuat(),
	}
	packet := EncodeState(snapshot)
	if len(packet) != StateBytes {
		t.Fatalf("state packet is %d bytes, want %d", len(packet), StateBytes)
	}
	if packet[0] != MessageState || binary.LittleEndian.Uint32(packet[1:5]) != 0x11223344 {
		t.Fatalf("invalid packet header: %v", packet[:7])
	}
	if packet[5] != 0x05 || packet[6] != 0x01 {
		t.Fatalf("invalid masks: %08b %08b", packet[5], packet[6])
	}
	if binary.LittleEndian.Uint16(packet[7:9]) != 7 || binary.LittleEndian.Uint16(packet[9:11]) != 9 {
		t.Fatalf("invalid score: %v", packet[7:11])
	}
	if value := math.Float32frombits(binary.LittleEndian.Uint32(packet[11:15])); value != 1.25 {
		t.Fatalf("first float is %f", value)
	}
}

func TestInputPacketDecodeAndSanitize(t *testing.T) {
	packet := []byte{MessageInput, 9, 0, 0, 0, 0xff, 0xff}
	input, ok := DecodeInput(packet)
	if !ok {
		t.Fatal("packet was rejected")
	}
	if input.Sequence != 9 || input.Mask != 0xff || input.Edges != 0x07 {
		t.Fatalf("unexpected input: %+v", input)
	}
}

func BenchmarkEncodeState(b *testing.B) {
	world := game.NewWorld(game.DefaultConfig())
	for slot := range world.Cars {
		world.SetConnected(slot, true)
	}
	snapshot := world.Snapshot()
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		_ = EncodeState(snapshot)
	}
}
