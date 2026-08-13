package protocol

import (
	"encoding/binary"
	"math"
	"testing"

	"rocket-vibe/internal/game"
)

func TestStatePacketMatchesBrowserLayout(t *testing.T) {
	snapshot := game.Snapshot{Tick: 0x11223344, ConnectedMask: 0x05, GroundMask: 0x01, OrangeScore: 7, BlueScore: 9, Boost: [game.MaxPlayers]uint8{100, 55, 20, 0}, BoostPadMask: (uint64(1) << 33) | 0xa55a}
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
	if packet[11] != 100 || packet[12] != 55 || packet[13] != 20 || packet[14] != 0 {
		t.Fatalf("invalid boost bytes: %v", packet[11:15])
	}
	if binary.LittleEndian.Uint64(packet[15:23]) != (uint64(1)<<33)|0xa55a {
		t.Fatalf("invalid boost pad mask: %016x", binary.LittleEndian.Uint64(packet[15:23]))
	}
	if value := math.Float32frombits(binary.LittleEndian.Uint32(packet[23:27])); value != 1.25 {
		t.Fatalf("first float is %f", value)
	}
}

func TestInputPacketDecodeAndSanitize(t *testing.T) {
	packet := []byte{MessageInput, 9, 0, 0, 0, 0xff, 0xff, 0xff}
	input, ok := DecodeInput(packet)
	if !ok {
		t.Fatal("packet was rejected")
	}
	if input.Sequence != 9 || input.Mask != 0xff || input.Edges != 0x07 || input.Flags != 0x03 {
		t.Fatalf("unexpected input: %+v", input)
	}
}

func TestAnalogInputPacketDecodesSignedAxes(t *testing.T) {
	packet := []byte{MessageInput, 21, 0, 0, 0, game.InputW | game.InputA, 0, game.InputFlagAnalog | game.InputFlagDrift, 64, 160}
	input, ok := DecodeInput(packet)
	if !ok {
		t.Fatal("analog packet was rejected")
	}
	if input.Flags&game.InputFlagAnalog == 0 {
		t.Fatalf("analog flag missing: %+v", input)
	}
	if math.Abs(input.Throttle-64.0/127.0) > 1e-9 {
		t.Fatalf("throttle decoded as %f", input.Throttle)
	}
	if math.Abs(input.Steer-(-96.0/127.0)) > 1e-9 {
		t.Fatalf("steer decoded as %f", input.Steer)
	}
}

func TestEightByteDigitalInputIgnoresAnalogAxes(t *testing.T) {
	packet := []byte{MessageInput, 5, 0, 0, 0, game.InputA, 0, game.InputFlagDrift}
	input, ok := DecodeInput(packet)
	if !ok {
		t.Fatal("eight-byte packet was rejected")
	}
	if input.Throttle != 0 || input.Steer != 0 || input.Flags != game.InputFlagDrift {
		t.Fatalf("legacy digital input changed meaning: %+v", input)
	}
}

func TestLegacySevenByteInputDefaultsFlagsToZero(t *testing.T) {
	packet := []byte{MessageInput, 4, 0, 0, 0, game.InputW, 0}
	input, ok := DecodeInput(packet)
	if !ok {
		t.Fatal("legacy packet was rejected")
	}
	if input.Flags != 0 {
		t.Fatalf("legacy packet unexpectedly set flags: %+v", input)
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
