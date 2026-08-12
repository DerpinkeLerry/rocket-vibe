package server

import (
	"context"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	writeTimeout = 3 * time.Second
	pingInterval = 20 * time.Second
)

type outboundMessage struct {
	kind websocket.MessageType
	data []byte
}

type client struct {
	id   string
	conn *websocket.Conn
	slot int
	name string
	team string

	ctx      context.Context
	cancel   context.CancelFunc
	stopOnce sync.Once
	control  chan outboundMessage
	snapshot chan []byte

	ackedAny    bool
	ackedActive bool
	motionAcked bool
}

func newClient(id string, connection *websocket.Conn, name string) *client {
	ctx, cancel := context.WithCancel(context.Background())
	return &client{
		id:       id,
		conn:     connection,
		slot:     -1,
		name:     name,
		ctx:      ctx,
		cancel:   cancel,
		control:  make(chan outboundMessage, 32),
		snapshot: make(chan []byte, 1),
	}
}

func (connected *client) offerJSON(message []byte) bool {
	copyOfMessage := append([]byte(nil), message...)
	select {
	case connected.control <- outboundMessage{kind: websocket.MessageText, data: copyOfMessage}:
		return true
	case <-connected.ctx.Done():
		return false
	default:
		connected.stop()
		return false
	}
}

// offerSnapshot keeps at most one unsent snapshot. A congested connection gets
// the freshest world state instead of accumulating visible latency.
func (connected *client) offerSnapshot(message []byte) {
	copyOfMessage := append([]byte(nil), message...)
	select {
	case connected.snapshot <- copyOfMessage:
		return
	default:
	}
	select {
	case <-connected.snapshot:
	default:
	}
	select {
	case connected.snapshot <- copyOfMessage:
	default:
	}
}

func (connected *client) runWriter() error {
	ping := time.NewTicker(pingInterval)
	defer ping.Stop()

	for {
		// Control messages (welcome, roster and pong) have priority over a state
		// snapshot because they are rare and affect connection lifecycle.
		select {
		case message := <-connected.control:
			if err := connected.write(message); err != nil {
				return err
			}
			continue
		default:
		}

		select {
		case <-connected.ctx.Done():
			return connected.ctx.Err()
		case message := <-connected.control:
			if err := connected.write(message); err != nil {
				return err
			}
		case message := <-connected.snapshot:
			if err := connected.write(outboundMessage{kind: websocket.MessageBinary, data: message}); err != nil {
				return err
			}
		case <-ping.C:
			ctx, cancel := context.WithTimeout(connected.ctx, writeTimeout)
			err := connected.conn.Ping(ctx)
			cancel()
			if err != nil {
				return err
			}
		}
	}
}

func (connected *client) write(message outboundMessage) error {
	ctx, cancel := context.WithTimeout(connected.ctx, writeTimeout)
	defer cancel()
	return connected.conn.Write(ctx, message.kind, message.data)
}

func (connected *client) stop() {
	connected.stopOnce.Do(func() {
		connected.cancel()
		_ = connected.conn.CloseNow()
	})
}
