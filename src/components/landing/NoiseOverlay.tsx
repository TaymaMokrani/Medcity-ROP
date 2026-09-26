export default function NoiseOverlay() {
    return (
        <div className="pointer-events-none fixed inset-0 z-[999] opacity-[0.08] mix-blend-soft-light">
            <div
                className="absolute inset-0"
                style={{
                    backgroundImage: "url(/noise.png?v=2)",
                    backgroundRepeat: "repeat",
                    backgroundPosition: "center top",
                    backgroundSize: "153.5px auto",
                }}
            />
        </div>
    );
}
