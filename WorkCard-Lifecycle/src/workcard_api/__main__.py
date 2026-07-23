import uvicorn

if __name__ == "__main__":
    uvicorn.run("workcard_api.app:app", host="0.0.0.0", port=8000)  # noqa: S104
