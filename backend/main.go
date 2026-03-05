package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"sync"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/gorilla/websocket"
	"github.com/graphql-go/graphql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type ProductionData struct {
	PrinterSpeed   float64 `json:"printer_speed"`
	CutterPressure float64 `json:"cutter_pressure"`
	SauceTemp      float64 `json:"sauce_temp"`
}

type Anomaly struct {
	ID        uint      `gorm:"primaryKey"`
	MachineID string    `json:"machineId"`
	Value     float64   `json:"value"`
	CreatedAt time.Time `json:"createdAt"`
}

//The structure of the message that will be sent via WebSocket
type WSMessage struct {
	Metrics   ProductionData `json:"metrics"`
	Anomalies []Anomaly      `json:"anomalies"` // If empty - all is good
}

var (
	rdb *redis.Client
	db  *gorm.DB
	ctx = context.Background()
	
	// The structure for setting up WebSockets
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true }, // Allow connections from React
	}
	clients      = make(map[*websocket.Conn]bool) // List of all open browser tabs
	clientsMutex sync.Mutex                       // Protection from concurrent writes
)

func simulateProduction() {
	for {
		printerSpeed := 300 + rand.Float64()*200
		if rand.Intn(20) == 0 { printerSpeed = float64(rand.Intn(90)) } else if rand.Intn(20) == 1 { printerSpeed = 610 + rand.Float64()*50 }

		cutterPressure := 40 + rand.Float64()*20
		if rand.Intn(20) == 0 { cutterPressure = 80 + rand.Float64()*10 }

		sauceTemp := 80 + rand.Float64()*10
		if rand.Intn(20) == 0 { sauceTemp = 96 + rand.Float64()*10 }

		data := ProductionData{PrinterSpeed: printerSpeed, CutterPressure: cutterPressure, SauceTemp: sauceTemp}
		
		jsonData, _ := json.Marshal(data)
		rdb.Set(ctx, "current_production", jsonData, 0)

		var currentAnomalies []Anomaly

		// Save anomalies and add them to the list for sending to the frontend
		if printerSpeed < 100 || printerSpeed > 600 {
			a := Anomaly{MachineID: "Digital Printer", Value: printerSpeed, CreatedAt: time.Now()}
			db.Create(&a)
			currentAnomalies = append(currentAnomalies, a)
		}
		if cutterPressure < 30 || cutterPressure > 70 {
			a := Anomaly{MachineID: "Die-Cutter", Value: cutterPressure, CreatedAt: time.Now()}
			db.Create(&a)
			currentAnomalies = append(currentAnomalies, a)
		}
		if sauceTemp > 95 || sauceTemp < 75 {
			a := Anomaly{MachineID: "Mule Sauce Line", Value: sauceTemp, CreatedAt: time.Now()}
			db.Create(&a)
			currentAnomalies = append(currentAnomalies, a)
		}

		// Sending data to all connected clients via WebSocket
		msg := WSMessage{Metrics: data, Anomalies: currentAnomalies}
		
		clientsMutex.Lock()
		for client := range clients {
			err := client.WriteJSON(msg)
			if err != nil { // If client closes the tab - remove it
				client.Close()
				delete(clients, client)
			}
		}
		clientsMutex.Unlock()

		time.Sleep(2 * time.Second)
	}
}

// The handler for WebSocket connections
func wsHandler(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil { return }
	
	clientsMutex.Lock()
	clients[ws] = true
	clientsMutex.Unlock()
}

func restHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	val, err := rdb.Get(ctx, "current_production").Result()
	if err != nil {
		http.Error(w, "No data available", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(val))
}

func main() {
	rdb = redis.NewClient(&redis.Options{Addr: "redis:6379"})
	dsn := "host=postgres user=admin password=secretpassword dbname=factory_db port=5432 sslmode=disable"
	var err error
	for i := 1; i <= 10; i++ {
		db, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
		if err == nil {
			fmt.Println("🚀 Successfully connected to Postgres!")
			break
		}
		time.Sleep(2 * time.Second)
	}
	if err != nil { log.Fatal("Failed to connect to DB:", err) }
	db.AutoMigrate(&Anomaly{})

	go simulateProduction()

	anomalyType := graphql.NewObject(graphql.ObjectConfig{
		Name: "Anomaly",
		Fields: graphql.Fields{
			"machineId": &graphql.Field{Type: graphql.String},
			"value":     &graphql.Field{Type: graphql.Float},
			"createdAt": &graphql.Field{Type: graphql.String},
		},
	})
	rootQuery := graphql.NewObject(graphql.ObjectConfig{
		Name: "RootQuery",
		Fields: graphql.Fields{
			"anomalies": &graphql.Field{
				Type: graphql.NewList(anomalyType),
				Resolve: func(p graphql.ResolveParams) (interface{}, error) {
					var anomalies []Anomaly
					db.Order("created_at desc").Limit(10).Find(&anomalies)
					return anomalies, nil
				},
			},
		},
	})
	schema, _ := graphql.NewSchema(graphql.SchemaConfig{Query: rootQuery})

	http.HandleFunc("/api/production", restHandler)
	http.HandleFunc("/ws", wsHandler) // Handler for WebSocket connections
	http.HandleFunc("/graphql", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" { return }
		var req struct { Query string `json:"query"` }
		json.NewDecoder(r.Body).Decode(&req)
		result := graphql.Do(graphql.Params{Schema: schema, RequestString: req.Query})
		json.NewEncoder(w).Encode(result)
	})

	fmt.Println("Server is running on port 8080...")
	log.Fatal(http.ListenAndServe(":8080", nil))
}